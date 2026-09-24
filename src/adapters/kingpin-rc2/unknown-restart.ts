import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { startRestartChild } from './restart-process.ts';
import { crashSnapshot } from './unknown-restart-snapshot.ts';
import { runScenario } from '../../core/runner.ts';
import { translateEffects } from './gateway.ts';
import { unknownRestartScenario } from '../../../scenarios/unknown-execution-survives-restart.ts';
function lockProbe(root: string, wait: boolean) {
  // Probe the same flock used by native cde_worker.py; never replace/remove its inode.
  return JSON.parse(execFileSync(process.env.CDE_PYTHON ?? 'python3', ['-c', `
import fcntl,json,os,sys,time
fd=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW)
end=time.monotonic()+(5 if sys.argv[2]=='wait' else 0)
while True:
 try:
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  print(json.dumps({'acquired':True,'inode':os.fstat(fd).st_ino}));break
 except BlockingIOError:
  if time.monotonic()>=end:
   print(json.dumps({'acquired':False,'inode':os.fstat(fd).st_ino}));break
  time.sleep(.01)
os.close(fd)
`, join(root, 'state.sqlite.runtime.lock'), wait ? 'wait' : 'once'], { encoding: 'utf8', timeout: 7000 }));
}
export async function runUnknownRestart() {
  const root = mkdtempSync(join(tmpdir(), 'unknown-restart-'));
  const children: ReturnType<typeof startRestartChild>[] = [];
  try {
    return await runScenario(unknownRestartScenario, {
      async inject() { throw new Error('No authority injection in crash recovery'); },
      async submit(request) {
        const entry = new URL('./unknown-restart-child.ts', import.meta.url), trace = ['A-spawn'];
        children.push(startRestartChild(entry, root, 'create'));
        const a = await children[0].ready(); trace.push('A-ready');
        const boundaryPromise = children[0].wait('boundary'); children[0].send('execute');
        const boundary = await boundaryPromise; trace.push('after-effect-boundary');
        const atBoundary = crashSnapshot(root), ownedA = lockProbe(root, false);
        children[0].kill(); const exitA = await children[0].exited; trace.push('A-SIGKILL-exited');
        if (exitA.signal !== 'SIGKILL') throw new Error('Expected actual SIGKILL');
        const afterDeath = crashSnapshot(root); trace.push('durable-state-inspected');
        const released = lockProbe(root, true);
        if (!released.acquired) throw new Error('CDE ownership not released after A death');
        trace.push('ownership-released', 'B-spawn');
        children.push(startRestartChild(entry, root, 'reopen'));
        const b = await children[1].ready(); trace.push('B-native-recovery-complete');
        const ownedB = lockProbe(root, false);
        const exitB = await children[1].close(); trace.push('B-exited');
        const native = afterDeath.events.find((e: any) => e.event_type === 'authority.decision');
        if (native?.outcome !== 'allow') throw new Error('No durable native ALLOW');
        return { requestId: request.requestId, decisionId: native.decision_id, result: 'ALLOW' as const,
          rationale: 'Original durable RC2 ALLOW; recovery emits no new governance decision.',
          evidence: { rc2_unknown_restart: { a, b, boundary, atBoundary, afterDeath, ownedA, released, ownedB, exitA, exitB, trace,
            sources: { governance: 'rc2', execution: 'rc2', recovery: 'rc2:ExecutionRuntime.recover',
              fault: 'harness:SIGKILL', calls: 'harness:sandbox-call-observation' } } } };
      },
    }, async (request, decision) => {
      const e = decision.evidence.rc2_unknown_restart as any;
      return translateEffects(request.requestId, { nativeRequestId: e.afterDeath.ledger[0].request_id,
        audit: e.b.snapshot.events, ledgerBefore: e.a.snapshot.ledger, ledgerAfter: e.b.snapshot.ledger,
        fileBefore: e.a.snapshot.file, fileAfter: e.b.snapshot.file });
    });
  } finally { try { for (const child of children) await child.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}
