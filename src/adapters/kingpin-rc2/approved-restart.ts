import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startRestartChild } from './restart-process.ts';
import { harnessProvenance, sdkEquivalence, scenarioId } from './approved-restart-provenance.ts';
import { runScenario } from '../../core/runner.ts';
import { normalizeDecision } from './adapter.ts';
import { approvedSnapshot } from './approved-restart-snapshot.ts';
import { approvedRestartScenario as reviewRestartScenario } from '../../../scenarios/approved-review-revocation-survives-restart.ts';
export async function runApprovedRestart() {
  const root = mkdtempSync(join(tmpdir(), 'review-restart-'));
  const harness = harnessProvenance();
  const children: ReturnType<typeof startRestartChild>[] = [];
  try {
    return await runScenario(reviewRestartScenario, {
      async inject() { throw new Error('Review lifecycle is observed inside this driver'); },
      async submit(request) {
        const entry = new URL('./approved-restart-child.ts', import.meta.url), trace = ['A-spawn'];
        children.push(startRestartChild(entry, root, 'create'));
        const a = await children[0].ready(); trace.push('A-ready');
        const first = await children[0].rpc('lifecycle'); trace.push('approval-and-revocation-observed');
        const closedA = children[0].wait('closed');
        const [exitA, endA] = await Promise.all([children[0].close(), closedA]);
        const runtimeAfterA = endA.runtime; trace.push('A-exited');
        if (exitA.code !== 0) throw new Error('A did not exit cleanly');
        trace.push('B-spawn'); children.push(startRestartChild(entry, root, 'reopen'));
        const b = await children[1].ready(); trace.push('B-ready');
        const replay = await children[1].rpc('replay', { reviewId: first.held.reviewId }); trace.push('replay-observed');
        const closedB = children[1].wait('closed');
        const [exitB, endB] = await Promise.all([children[1].close(), closedB]);
        const runtimeAfterB = endB.runtime; trace.push('B-exited');
        if (exitB.code !== 0) throw new Error('B did not exit cleanly');
        const native = first.held.body.authority_decision;
        if (!native) throw new Error('No native review decision');
        return { requestId: request.requestId, decisionId: first.review.body.decision_id,
          result: normalizeDecision(native), rationale: native.reason,
          evidence: { rc2_approved_restart: { a, b, first, replay, exitA, exitB, trace,
            provenance: { schemaVersion: 1, scenarioId, adapter: 'kingpin-rc2-gateway',
              adapterLineage: 'Historical controlled-evaluator RC2 adapter name; not an SDK version selector',
              harness, runtime: a.runtime, runtimeAfterA, runtimeAfterB, sdkEquivalence: sdkEquivalence(a.runtime) }, final: approvedSnapshot(root),
            sources: { governance: 'rc2', execution: 'rc2', restart: 'harness', replay: 'native-http-refusal' } } } };
      },
    }, async (request, decision) => {
      const e = decision.evidence.rc2_approved_restart as any;
      const blocked = e.replay.response.status === 403 && e.replay.response.body.execution_authorized === false;
      const zero = [e.first.before, e.first.approved, e.first.after, e.b.snapshot, e.replay.before, e.replay.after, e.final]
        .every(s => s.ledger.length === 0 && s.calls.length === 0 && !s.file.exists);
      return { enforcement: blocked ? 'BLOCK' : 'DISPATCH', executions: [{ requestId: request.requestId,
        status: blocked && zero ? 'NOT_STARTED' : 'UNKNOWN',
        reason: 'Observed review consumption refusal; accounting, adapter-entry journal and bounded target inspected independently.' }] };
    });
  } finally { try { for (const child of children) await child.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}
