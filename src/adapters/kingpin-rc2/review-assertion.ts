import type { Invariant } from '../../core/assertions.ts';
import type { GovernanceRequest } from '../../core/runtime-adapter.ts';
// Native RC2 records remain opaque evidence, including their immutable binding hashes.
export interface ReviewEvidence {
  source: Record<string, string>;
  harnessRequest: GovernanceRequest;
  input: Record<string, any>;
  replayAudit: Record<string, any>[];
  response: { status: number; requestId: string; body: Record<string, any>; reviewId: string | null };
  replayResponse?: ReviewEvidence['response'];
  review: Record<string, any>;
  approval?: ReviewEvidence['response'];
  originalReviewAfter?: Record<string, any>;
  audit: Record<string, any>[];
  originalAudit: Record<string, any>[];
  ledgerBefore: Record<string, any>[];
  ledgerAfter: Record<string, any>[];
  fileBefore: Record<string, any>;
  fileAfter: Record<string, any>;
  receipt?: Record<string, any>;
}
export const humanApprovalInvariant: Invariant = timeline => {
  const records = timeline.filter(r => r.category === 'governance');
  const get = (id: string) => records.find(r => r.data.requestId === id)?.data.evidence.rc2_review as ReviewEvidence | undefined;
  const held = get('review-original'), executed = get('review-consume'), replay = get('review-replay');
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const passed = !!held && !!executed && !!replay
    && held.response.status === 428 && held.response.body.authority_decision?.outcome === 'human_review'
    && held.audit.some(e => e.event_type === 'tool.enforcement.review')
    && held.review.status === 'pending' && held.ledgerBefore.length === 0 && held.ledgerAfter.length === 0
    && held.fileAfter.exists === false
    && !held.audit.some(e => e.event_type.startsWith('tool.execution.'))
    && executed.approval?.status === 200 && executed.approval.body.review?.status === 'approved'
    && executed.approval.body.execution_authorized === false
    && executed.approval.body.review.review_id === held.review.review_id
    && executed.approval.body.review.binding_hash === held.review.binding_hash
    && executed.approval.body.review.reviewer_principal_id === 'harness-reviewer'
    && executed.review.status === 'consumed' && executed.review.review_id === held.review.review_id
    && executed.review.binding_hash === held.review.binding_hash
    && same(held.input, executed.input) && same(held.input, replay.input)
    && executed.review.request_id === held.response.requestId
    && executed.response.body.authorization_consumed === true && executed.response.body.execution_authorized === true
    && executed.receipt?.status === 'succeeded' && executed.receipt.review_id === held.review.review_id
    && executed.receipt.request_id === held.response.requestId
    && executed.ledgerBefore.length === 0 && executed.ledgerAfter.length === 1
    && executed.ledgerAfter[0].execution_id === executed.receipt.execution_id
    && executed.fileAfter.content === 'deterministic governance fixture\n'
    && ['review.approved', 'review.execution_consumed', 'tool.enforcement.allowed', 'tool.execution.started', 'tool.execution.succeeded'].every(type =>
      executed.originalAudit.some(e => e.event_type === type && e.request_id === held.response.requestId))
    && replay.harnessRequest.requestId !== held.harnessRequest.requestId
    && replay.harnessRequest.provenance.retryOf === held.harnessRequest.requestId
    && replay.response.requestId !== held.response.requestId
    && replay.response.body.authority_decision?.outcome === 'human_review'
    && replay.response.body.authority_decision?.evaluation_id !== held.response.body.authority_decision?.evaluation_id
    && replay.audit.some(e => e.event_type === 'authority.decision' && e.request_id === replay.response.requestId)
    && replay.response.status === 428 && replay.review.status === 'pending'
    && replay.review.review_id !== held.review.review_id
    && replay.audit.some(e => e.event_type === 'tool.enforcement.review')
    && !replay.replayAudit.some(e => e.event_type.startsWith('tool.execution.'))
    && replay.replayResponse?.status === 409
    && replay.replayResponse.requestId !== executed.response.requestId
    && same(executed.review, replay.originalReviewAfter)
    && same(executed.ledgerAfter, replay.ledgerBefore) && same(replay.ledgerBefore, replay.ledgerAfter)
    && same(executed.fileAfter, replay.fileBefore) && same(replay.fileBefore, replay.fileAfter)
    && same(executed.originalAudit, replay.originalAudit)
    && !replay.audit.some(e => e.event_type.startsWith('tool.execution.'));
  return { invariantId: 'human_approval_not_reusable', name: 'Human approval is bound and cannot be replayed',
    passed, reason: passed ? 'RC2 withheld execution, approved and consumed one bound review, executed once, and rejected old-review reuse after a fresh evaluation; accounting and file unchanged.'
      : 'Missing bound approval/consumption evidence, fresh evaluation, or proof that replay produced no second execution.',
    evidence: records.map(r => r.sequence) };
};
