import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Timeline } from '../../core/timeline.ts';
import { createGatewayAdapter } from './gateway.ts';
import { harnessProvenance, runtimeProvenance } from './approved-restart-provenance.ts';
import { scenarioId, operation, verifyForeignReview } from './foreign-review-check.ts';

export async function runForeignReview() {
  const runtime = runtimeProvenance(), harness = harnessProvenance();
  const subject = { requestId: 'original', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x',
    target: 'target-x', context: {}, provenance: { scenarioId } };
  const f = await createGatewayAdapter(subject, { receiptFailure: false, reviewer: true, observeExecute: true,
    delegatedAgent: { principal: 'principal-b', agent: 'agent-b', sessionId: scenarioId + '-b' } });
  try {
    let sequence = 0;
    const sample = () => {
      const ledger = f.ledger(), ledgerRead = ++sequence;
      const observer = f.executeObservation(), observerRead = ++sequence;
      const directory = readdirSync(join(f.root, 'sandbox')).sort(), directoryRead = ++sequence;
      return { ledger, observer, directory, order: { ledgerRead, observerRead, directoryRead } };
    };
    const inspect = async (id: string) => {
      const result = await f.http('/reviews/' + id, undefined, 'reviewer');
      if (result.status !== 200) throw new Error('Review inspection unavailable');
      return result.body;
    };
    const initial = sample();
    const warmup = await f.http('/turn', { session_id: scenarioId, speaker_id: subject.agent, channel_id: 'channel',
      scene_id: 'scene', turn_id: 'review-warmup', ts: 0, text: 'You need to do it now immediately.' });
    if (warmup.status !== 200) throw new Error('CDE warmup failed');
    const body = { ...f.input(subject), plan_id: operation.plan_id, user_request: '.' };
    const proposal = await f.exchange('/tool/observed', JSON.stringify(body), 'agent');
    const id = proposal.response.reviewId;
    if (!id) throw new Error('Missing native review ID');
    const pending = await inspect(id);
    const approval = await f.exchange('/reviews/' + id + '/approve', '{}', 'reviewer');
    const before = await inspect(id), originalAudit = await f.audit(proposal.response.requestId), approved = sample();
    const dispatch = ++sequence;
    const attempt = await f.exchange('/reviews/' + id + '/execute', proposal.transport.serialized, 'delegate');
    const received = ++sequence;
    const evidence = { exchangeOrder: { dispatch, received }, proposal, pending, approval, before, attempt, after: await inspect(id),
      originalAudit, originalAuditAfter: await f.audit(proposal.response.requestId), attemptAudit: await f.audit(attempt.response.requestId),
      initial, approved, final: sample() };
    // Pure native record validation in the live driver; offline verification stays portable.
    const { validateReview } = await import(pathToFileURL(join(runtime.root, 'kingpin/review/model.js')).href);
    for (const record of [pending, approval.response.body.review, before, evidence.after]) validateReview(record);
    let reason = 'Original approval preserved after authenticated ingress refusal';
    let passed = true;
    try { verifyForeignReview(evidence); } catch (error) { passed = false; reason = String(error); }
    assert.deepEqual(runtimeProvenance(), runtime, 'Runtime inventory changed during run');
    assert.deepEqual(harnessProvenance(), harness, 'Harness inventory changed during run');
    const provenance = { scenarioId, adapter: 'kingpin-rc2-gateway', build: f.build,
      adapterLineage: 'Harness RC2 Gateway adapter loading the configured Kingpin repository source',
      harness, runtime, inventoryVerifiedAcrossRun: true };
    const timeline = new Timeline();
    // Only A has a native governance decision. The B exchange is ingress evidence.
    timeline.append(scenarioId, { order: 1, timestamp: 0 }, { category: 'governance',
      data: { requestId: proposal.response.requestId, decisionId: pending.decision_id, result: 'INDETERMINATE',
        rationale: 'Original HUMAN REVIEW', evidence: { foreignReview: evidence, provenance } } });
    const assertion = { invariantId: scenarioId, name: 'Foreign principal ingress refusal', passed, reason, evidence: [1] };
    timeline.append(scenarioId, { order: 2, timestamp: 1 }, { category: 'assertion', data: assertion });
    return { passed, assertions: [assertion], timeline: timeline.snapshot() };
  } finally { await f.close(); }
}
