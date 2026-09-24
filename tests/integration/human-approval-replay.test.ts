import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHumanApprovalReplay } from '../../src/adapters/kingpin-rc2/review.ts';
import type { ReviewEvidence } from '../../src/adapters/kingpin-rc2/review-assertion.ts';

test('real human review executes once; fresh evaluation and old approval replay cannot execute again', async () => {
  const result = await runHumanApprovalReplay();
  assert.equal(result.passed, true, result.assertions[0].reason);
  const decisions = result.timeline.filter(r => r.category === 'governance');
  assert.deepEqual(decisions.map(r => r.data.result), ['INDETERMINATE', 'ALLOW', 'INDETERMINATE']);
  const [held, done, replay] = decisions.map(r => r.data.evidence.rc2_review as ReviewEvidence);
  assert.equal(held.ledgerAfter.length, 0);
  assert.equal(done.approval?.body.review.reviewer_principal_id, 'harness-reviewer');
  assert.equal(done.receipt?.authorization_source, 'review');
  assert.equal(done.receipt?.review_id, held.review.review_id);
  assert.equal(done.receipt?.arguments_hash, held.review.binding.arguments_hash);
  assert.equal(done.receipt?.decision_id, held.review.decision_id);
  assert.equal(done.receipt?.principal_id, held.review.principal_id);
  assert.equal(done.ledgerAfter.length, 1);
  assert.equal(replay.ledgerAfter.length - replay.ledgerBefore.length, 0);
  assert.equal(replay.replayResponse?.status, 409);
  assert.equal(replay.originalReviewAfter?.status, 'consumed');
  assert.equal(replay.review.status, 'pending');
  assert.notEqual(replay.response.body.authority_decision.evaluation_id, held.response.body.authority_decision.evaluation_id);
  assert.notEqual(replay.replayResponse?.requestId, done.response.requestId);
  assert.deepEqual(replay.input, held.input);
  assert.deepEqual(result.timeline.filter(r => r.category === 'execution').map(r => r.data.status),
    ['NOT_STARTED', 'STARTED', 'SUCCEEDED', 'NOT_STARTED']);
});
