import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanApprovalReplay, reviewedRequest } from '../scenarios/human-approval-replay.ts';
import { humanApprovalInvariant, type ReviewEvidence } from '../src/adapters/kingpin-rc2/review-assertion.ts';
import { reviewEffects } from '../src/adapters/kingpin-rc2/review.ts';
import { runScenario } from '../src/core/runner.ts';
import type { RuntimeAdapter, RuntimeDecision } from '../src/core/runtime-adapter.ts';

function fakeReviewBoundary(reusable: boolean): RuntimeAdapter {
  const operation = { tool: 'fs.write', args: { path: 'effect.txt', content: 'deterministic governance fixture\n' } };
  const review = { review_id: 'review-1', request_id: 'native-original', binding_hash: 'bound-hash' };
  const response = (status: number, requestId: string, body: Record<string, any>) => ({ status, requestId, body, reviewId: null });
  const event = (event_type: string) => ({ event_type, request_id: 'native-original', execution_id: 'execution-1' });
  const held = {
    source: {}, harnessRequest: reviewedRequest, input: operation, replayAudit: [],
    response: response(428, 'native-original', { authority_decision: { outcome: 'human_review', evaluation_id: 'evaluation-1' } }),
    review: { ...review, status: 'pending' }, audit: [event('tool.enforcement.review')], originalAudit: [],
    ledgerBefore: [], ledgerAfter: [], fileBefore: { exists: false }, fileAfter: { exists: false },
  } satisfies ReviewEvidence;
  const ledger = [{ execution_id: 'execution-1' }];
  const file = { exists: true, content: operation.args.content };
  const consumed = { ...review, status: 'consumed' };
  const audit = ['review.approved', 'review.execution_consumed', 'tool.enforcement.allowed', 'tool.execution.started', 'tool.execution.succeeded'].map(event);
  const executed: ReviewEvidence = { ...held, review: consumed,
    approval: response(200, 'native-approve', { execution_authorized: false, review: { ...review, status: 'approved', reviewer_principal_id: 'harness-reviewer' } }),
    response: response(200, 'native-consume', { authorization_consumed: true, execution_authorized: true }),
    receipt: { status: 'succeeded', execution_id: 'execution-1', review_id: 'review-1', request_id: 'native-original' },
    originalAudit: audit, ledgerAfter: ledger, fileAfter: file };
  const replay: ReviewEvidence = { ...held, review: { ...review, review_id: 'review-2', status: 'pending' },
    response: response(428, 'native-fresh', { authority_decision: { outcome: 'human_review', evaluation_id: 'evaluation-2' } }),
    replayResponse: response(reusable ? 200 : 409, 'native-replay', { execution_authorized: reusable }),
    originalReviewAfter: consumed, originalAudit: audit,
    audit: [{ event_type: 'authority.decision', request_id: 'native-fresh' }, { event_type: 'tool.enforcement.review' }],
    ledgerBefore: ledger, ledgerAfter: reusable ? [...ledger, { execution_id: 'forbidden-reuse' }] : ledger,
    fileBefore: file, fileAfter: file };
  // Scripted boundary observations only: no replacement Kingpin policy.
  return { async inject() {}, async submit(request) {
    const phase = request.context.reviewPhase;
    const evidence = structuredClone(phase === 'request' ? held : phase === 'consume' ? executed : replay);
    evidence.harnessRequest = request;
    return { requestId: request.requestId, decisionId: phase === 'replay' ? 'decision-2' : 'decision-1',
      result: phase === 'consume' ? 'ALLOW' : 'INDETERMINATE', rationale: 'Scripted review boundary', evidence: { rc2_review: evidence } };
  } };
}
const observe = async (request: typeof reviewedRequest, decision: RuntimeDecision) => reviewEffects(request.requestId, decision);

test('review mapping retains hold, approval and consumed execution evidence', async () => {
  const result = await runScenario(humanApprovalReplay, fakeReviewBoundary(false), observe);
  assert.equal(result.passed, true);
  assert.deepEqual(result.timeline.filter(r => r.category === 'execution').map(r => r.data.status),
    ['NOT_STARTED', 'STARTED', 'SUCCEEDED', 'NOT_STARTED']);
  const missingApproval = structuredClone(result.timeline);
  const executed = missingApproval.find(r => r.category === 'governance' && r.data.requestId === 'review-consume');
  assert.ok(executed?.category === 'governance');
  delete (executed.data.evidence.rc2_review as ReviewEvidence).approval;
  assert.equal(humanApprovalInvariant(missingApproval).passed, false);
});

test('reusable-approval fake fails even when fresh governance still says HUMAN REVIEW', async () => {
  const result = await runScenario(humanApprovalReplay, fakeReviewBoundary(true), observe);
  assert.equal(result.passed, false);
  assert.equal(result.assertions[0].invariantId, 'human_approval_not_reusable');
  assert.equal(humanApprovalInvariant([]).passed, false);
});
