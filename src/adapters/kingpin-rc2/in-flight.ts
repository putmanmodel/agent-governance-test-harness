import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { inFlightRevocation } from '../../../scenarios/in-flight-revocation.ts';
import { runScenario } from '../../core/runner.ts';
import type { RuntimeAdapter } from '../../core/runtime-adapter.ts';
import { normalizeDecision } from './adapter.ts';
import { translateEffects } from './gateway.ts';
import { nativeDisposition } from './in-flight-assertion.ts';
import type { FlightEvidence, NativeRecord, Snapshot } from './in-flight-assertion.ts';

// A separate read-only connection observes the start that RC2 committed before invocation.
function snapshot(root: string): Snapshot {
  const db = new DatabaseSync(join(root, 'state.sqlite'), { readOnly: true });
  try {
    return { ledger: db.prepare('SELECT record FROM executions ORDER BY rowid').all().map(r => JSON.parse(String(r.record))),
      events: db.prepare('SELECT sequence, record FROM governance_events ORDER BY sequence').all()
        .map(r => ({ sequence: Number(r.sequence), record: JSON.parse(String(r.record)) })),
      fileExists: existsSync(join(root, 'sandbox/effect.txt')) };
  } finally { db.close(); }
}

export async function runInFlightRevocation() {
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL('./in-flight-worker.ts', import.meta.url), { workerData: { gate: gate.buffer } });
  // Only this scenario's fixed worker messages; not a general task scheduler.
  const queued = new Map<string, NativeRecord>();
  const pending = new Map<string, { resolve: (value: NativeRecord) => void; reject: (error: Error) => void }>();
  let failure: Error | undefined;
  const rejectAll = (error: Error) => { failure = error; for (const waiting of pending.values()) waiting.reject(error); pending.clear(); };
  worker.on('error', rejectAll);
  worker.on('message', (message: NativeRecord) => {
    const waiting = pending.get(message.type);
    if (waiting) { pending.delete(message.type); message.error ? waiting.reject(new Error(message.error)) : waiting.resolve(message); }
    else queued.set(message.type, message);
  });
  const wait = (type: string): Promise<NativeRecord> => {
    if (failure) return Promise.reject(failure);
    const message = queued.get(type);
    if (message) { queued.delete(type); return message.error ? Promise.reject(new Error(message.error)) : Promise.resolve(message); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(type); reject(new Error(`Worker timeout: ${type}`)); }, 20_000);
      pending.set(type, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  };
  const rpc = (type: string, fields = {}) => { const response = wait(type); worker.postMessage({ type, ...fields }); return response; };
  const release = () => { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); };
  let ready = false;
  try {
    const config = await wait('ready'); ready = true;
    const trace: FlightEvidence['trace'] = [];
    const origin = performance.now();
    const mark = (event: string) => trace.push({ sequence: trace.length + 1, event, elapsedMs: performance.now() - origin });
    let experiment: FlightEvidence;
    const runtime: RuntimeAdapter = {
      async inject() { throw new Error('In-flight revocation is coordinated inside the RC2 adapter'); },
      async submit(request) {
        if (request.requestId === 'in-flight-first') {
          const firstResponse = rpc('first').then(value => { mark('first-response'); return value.response; });
          void firstResponse.catch(() => {});
          await wait('barrier');
          const started = snapshot(config.root);
          if (started.ledger.length !== 1 || started.ledger[0].status !== 'started') throw new Error('No committed native STARTED receipt at barrier');
          mark('start-observed');
          // Credentials arrive only over the private worker channel and never enter evidence.
          mark('revocation-attempt');
          let acknowledged = false;
          let sentResolve!: () => void, sentReject!: (error: Error) => void;
          const sent = new Promise<void>((resolve, reject) => { sentResolve = resolve; sentReject = reject; });
          const revocation = new Promise<FlightEvidence['revocation']>((resolve, reject) => {
            const client = httpRequest(config.connection.url + '/revoke', { method: 'POST',
              headers: { authorization: config.connection.authorization, 'content-type': 'application/json' } }, response => {
              let data = '';
              response.setEncoding('utf8'); response.on('data', chunk => { data += chunk; });
              response.on('error', reject);
              response.on('end', () => {
                try {
                  const value = { status: response.statusCode!, requestId: String(response.headers['x-request-id']), body: JSON.parse(data) };
                  acknowledged = true; mark('revocation-acknowledged'); resolve(value);
                } catch (error) { reject(error); }
              });
            });
            client.on('finish', () => { mark('revocation-request-sent'); sentResolve(); });
            client.on('error', error => { sentReject(error); reject(error); });
            client.setTimeout(10_000, () => client.destroy(new Error('Revocation request timed out')));
            client.end(JSON.stringify(config.input));
          });
          void revocation.catch(() => {});
          await sent;
          // Bounded observation window, not a fabricated native timestamp or lock acknowledgement.
          await new Promise(resolve => setTimeout(resolve, 200));
          const acknowledgementWhileHeld = acknowledged;
          mark(acknowledged ? 'acknowledgement-before-release' : 'acknowledgement-pending');
          const held = snapshot(config.root);
          mark('barrier-release'); release();
          const [response, revoke] = await Promise.all([firstResponse, revocation]);
          if (revoke.status !== 200 || revoke.body.revoked !== true) throw new Error('Revocation not acknowledged');
          const collected = await rpc('collect', { firstId: response.requestId, executionId: started.ledger[0].execution_id });
          experiment = { sources: { timing: 'harness', governance: 'rc2:kingpin', enforcement: 'rc2:gateway', execution: 'rc2:execution', startSnapshot: 'rc2:sqlite' },
            cancellation_supported: false, cancellation_claimed: false, reportedDisposition: collected.receipt.status,
            trace: structuredClone(trace), started, held, revocation: revoke, acknowledgementWhileHeld,
            first: { response, audit: collected.audit, receipt: collected.receipt, ledger: collected.ledger, file: collected.file },
            afterFirst: snapshot(config.root) };
          const decision = collected.audit.find((e: NativeRecord) => e.event_type === 'authority.decision');
          if (decision?.outcome !== 'allow') throw new Error('Native initial authorization missing');
          return { requestId: request.requestId, decisionId: decision.decision_id, result: 'ALLOW',
            rationale: decision.reason_codes.join(', '), evidence: { rc2_in_flight: structuredClone(experiment) } };
        }
        if (request.requestId !== 'in-flight-later' || !experiment) throw new Error('Unexpected in-flight phase');
        mark('later-request');
        const later = await rpc('later'); mark('later-response');
        experiment = { ...experiment, trace: structuredClone(trace), later, afterLater: snapshot(config.root) };
        const decision = later.audit.find((e: NativeRecord) => e.event_type === 'authority.decision');
        if (!decision || !later.response.body.authority_decision) throw new Error('Native redispatch decision missing');
        return { requestId: request.requestId, decisionId: decision.decision_id,
          result: normalizeDecision(later.response.body.authority_decision), rationale: later.response.body.authority_decision.reason,
          evidence: { rc2_in_flight: structuredClone(experiment) } };
      },
    };
    return await runScenario(inFlightRevocation, runtime, async (request, decision) => {
      const e = decision.evidence.rc2_in_flight as FlightEvidence;
      if (request.requestId === 'in-flight-first') {
        const status = nativeDisposition[e.first.receipt.status];
        if (!status) throw new Error('Unsupported native execution disposition');
        const started = e.first.audit.find(r => r.event_type === 'tool.execution.started' && r.execution_id === e.first.receipt.execution_id);
        if (!started || !e.first.audit.some(r => r.event_type === 'tool.enforcement.allowed' && r.request_id === e.first.response.requestId)) {
          throw new Error('Native dispatch/start evidence missing');
        }
        return { enforcement: 'DISPATCH', executions: [
          { requestId: request.requestId, status: 'STARTED', reason: `rc2:execution ${started.execution_id}; committed before revocation attempt` },
          { requestId: request.requestId, status, reason: `rc2:execution ${e.first.receipt.execution_id}; native status=${e.first.receipt.status}; cancellation unsupported` },
        ] };
      }
      return translateEffects(request.requestId, { nativeRequestId: e.later!.response.requestId, audit: e.later!.audit,
        ledgerBefore: e.later!.before.ledger, ledgerAfter: e.later!.after.ledger,
        fileBefore: e.later!.before.file, fileAfter: e.later!.after.file });
    });
  } finally {
    release();
    try { if (ready && !failure) await rpc('close'); } finally { await worker.terminate(); }
  }
}
