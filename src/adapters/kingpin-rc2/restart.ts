import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restartScenario } from '../../../scenarios/capability-revocation-survives-restart.ts';
import { runScenario } from '../../core/runner.ts';
import type { RuntimeAdapter } from '../../core/runtime-adapter.ts';
import { normalizeDecision } from './adapter.ts';
import { translateEffects } from './gateway.ts';

function start(root: string, mode: 'create' | 'reopen') {
  const child = fork(new URL('./restart-child.ts', import.meta.url), [root, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let diagnostic = '', failure: Error | undefined;
  const queued = new Map<string, any>(), pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const fail = (error: Error) => { failure = error; for (const p of pending.values()) p.reject(error); pending.clear(); };
  child.stderr!.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-8192); });
  const exited = new Promise<{ pid: number; code: number | null; signal: string | null }>(resolve => {
    child.once('error', error => { fail(error); resolve({ pid: child.pid ?? -1, code: null, signal: 'spawn-error' }); });
    child.once('exit', (code, signal) => { fail(new Error(`Restart child exited: ${code ?? signal}; ${diagnostic}`)); resolve({ pid: child.pid!, code, signal }); });
  });
  child.on('message', (m: any) => {
    const p = pending.get(m.type);
    if (p) { pending.delete(m.type); m.error ? p.reject(new Error(m.error)) : p.resolve(m); }
    else queued.set(m.type, m);
  });
  const wait = (type: string): Promise<any> => {
    if (failure) return Promise.reject(failure);
    if (queued.has(type)) { const value = queued.get(type); queued.delete(type); return Promise.resolve(value); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(type); reject(new Error(`Restart child timeout: ${type}`)); }, 30000);
      pending.set(type, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  };
  const rpc = (type: string, fields = {}) => { const response = wait(type); child.send({ type, ...fields }); return response; };
  return { ready: () => wait('ready'), rpc, async close() {
    if (child.connected) child.send({ type: 'close' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { return await exited; } finally { clearTimeout(timer); }
  } };
}
export async function runRestart() {
  const root = mkdtempSync(join(tmpdir(), 'governance-restart-'));
  const children: ReturnType<typeof start>[] = [];
  const trace: string[] = [];
  let a: any, b: any, first: any, revocation: any, exitA: any, exitB: any;
  try {
    const runtime: RuntimeAdapter = {
      async inject(control) {
        if (!first || control.type !== 'REVOKE' || control.authorityRef !== 'write-capability') throw new Error('Invalid restart control');
        revocation = await children[0].rpc('revoke'); trace.push('revocation-acknowledged');
        exitA = await children[0].close(); trace.push('A-exited');
        if (exitA.code !== 0) throw new Error('Process A did not exit cleanly');
      },
      async submit(request) {
        let observation: any;
        if (request.requestId === 'restart-before') {
          trace.push('A-spawn'); children.push(start(root, 'create')); a = await children[0].ready(); trace.push('A-ready');
          first = observation = await children[0].rpc('submit', { request }); trace.push('control-observed');
        } else {
          if (!exitA || request.requestId !== 'restart-after') throw new Error('Invalid post-restart request');
          trace.push('B-spawn'); children.push(start(root, 'reopen')); b = await children[1].ready(); trace.push('B-ready');
          observation = await children[1].rpc('submit', { request }); trace.push('post-observed');
          exitB = await children[1].close(); trace.push('B-exited');
          if (exitB.code !== 0) throw new Error('Process B did not exit cleanly');
        }
        const decision = observation.audit.find((e: any) => e.event_type === 'authority.decision');
        if (!decision) throw new Error('Missing native decision');
        return { requestId: request.requestId, decisionId: decision.decision_id, result: normalizeDecision(observation.response.body.authority_decision),
          rationale: observation.response.body.authority_decision.reason,
          evidence: { rc2_restart: { observation, first, a, b, exitA, exitB, revocation, trace: [...trace],
            sources: { process: 'harness', governance: 'rc2', execution: 'rc2', cdeHistory: 'fresh-process-local' } } } };
      },
    };
    return await runScenario(restartScenario, runtime, async (request, decision) => {
      const e = (decision.evidence.rc2_restart as any).observation;
      return translateEffects(request.requestId, { nativeRequestId: e.response.requestId, audit: e.audit,
        ledgerBefore: e.before.ledger, ledgerAfter: e.after.ledger, fileBefore: e.before.file, fileAfter: e.after.file });
    });
  } finally {
    try { for (const child of children) await child.close(); } finally { rmSync(root, { recursive: true, force: true }); }
  }
}
