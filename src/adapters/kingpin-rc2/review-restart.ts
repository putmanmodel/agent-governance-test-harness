import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startRestartChild } from './restart-process.ts';
import { runScenario } from '../../core/runner.ts';
import { normalizeDecision } from './adapter.ts';
import { translateEffects } from './gateway.ts';
import { reviewRestartScenario } from '../../../scenarios/human-approval-consumption-survives-restart.ts';
export async function runReviewRestart() {
  const root = mkdtempSync(join(tmpdir(), 'review-restart-'));
  const children: ReturnType<typeof startRestartChild>[] = [];
  try {
    return await runScenario(reviewRestartScenario, {
      async inject() { throw new Error('Review lifecycle is observed inside this driver'); },
      async submit(request) {
        const entry = new URL('./review-restart-child.ts', import.meta.url), trace = ['A-spawn'];
        children.push(startRestartChild(entry, root, 'create'));
        const a = await children[0].ready(); trace.push('A-ready');
        const first = await children[0].rpc('lifecycle'); trace.push('consumption-and-execution-observed');
        const exitA = await children[0].close(); trace.push('A-exited');
        if (exitA.code !== 0) throw new Error('A did not exit cleanly');
        trace.push('B-spawn'); children.push(startRestartChild(entry, root, 'reopen'));
        const b = await children[1].ready(); trace.push('B-ready');
        const replay = await children[1].rpc('replay', { reviewId: first.held.reviewId }); trace.push('replay-observed');
        const exitB = await children[1].close(); trace.push('B-exited');
        if (exitB.code !== 0) throw new Error('B did not exit cleanly');
        const native = first.consumed.body.authority_decision;
        if (!native) throw new Error('No native consumption decision');
        return { requestId: request.requestId, decisionId: first.review.body.decision_id,
          result: normalizeDecision(native), rationale: native.reason,
          evidence: { rc2_review_restart: { a, b, first, replay, exitA, exitB, trace,
            sources: { governance: 'rc2', execution: 'rc2', restart: 'harness', replay: 'native-http-refusal' } } } };
      },
    }, async (request, decision) => {
      const e = (decision.evidence.rc2_review_restart as any).first;
      return translateEffects(request.requestId, { nativeRequestId: e.held.requestId, audit: e.audit,
        ledgerBefore: e.before.ledger, ledgerAfter: e.after.ledger, fileBefore: e.before.file, fileAfter: e.after.file });
    });
  } finally { try { for (const child of children) await child.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
}
