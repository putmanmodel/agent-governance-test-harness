import { isDeepStrictEqual as same } from 'node:util';
import type { Invariant } from '../../core/assertions.ts';
export const reviewRestartInvariant: Invariant = timeline => {
  const record = timeline.find(r => r.category === 'governance');
  const e = record?.category === 'governance' ? record.data.evidence.rc2_review_restart as any : undefined;
  const result = (passed: boolean) => ({ invariantId: 'consumed_human_approval_survives_restart', name: 'Consumed human approval survives restart', passed,
    reason: passed ? 'Consumed approval and successful effect survived process replacement; exact original-review replay was refused without another execution or effect.' : 'Missing or inconsistent review lifecycle, restart continuity, replay target or no-second-effect evidence.',
    evidence: record ? [record.sequence] : [] });
  if (!e?.first?.review?.body || !e.replay || !e.exitA || !e.exitB || !e.b) return result(false);
  const x = e.first, y = e.replay, r = x.review.body;
  const types = ['review.requested','review.approved','review.execution_authorized','review.execution_consumed','tool.enforcement.allowed','tool.execution.started','tool.execution.succeeded'];
  const indices = types.map(type => x.audit.findIndex((a: any) => a.event_type === type && a.request_id === r.request_id && a.decision_id === r.decision_id));
  const passed = record?.category === 'governance' && record.data.result === 'ALLOW' && record.data.decisionId === r.decision_id
    && x.held.status === 428 && x.held.body.authority_decision?.outcome === 'human_review'
    && x.pending.status === 200 && x.pending.body.status === 'pending' && x.pending.body.review_id === r.review_id
    && x.held.reviewId === r.review_id && x.held.requestId === r.request_id && x.held.body.top_event.event_id === r.evaluation_id
    && x.approval.status === 200 && x.approval.body.review.status === 'approved' && x.approval.body.execution_authorized === false
    && x.approval.body.review.review_id === r.review_id && r.reviewer_principal_id === 'harness-reviewer' && r.resolution === 'approve'
    && same(x.pending.body.binding, r.binding) && x.pending.body.binding_hash === r.binding_hash
    && x.approval.body.review.binding_hash === r.binding_hash && x.approval.body.review.resolved_at === r.resolved_at
    && r.status === 'consumed' && typeof r.consumed_at === 'string' && Number.isFinite(Date.parse(r.consumed_at))
    && x.consumed.status === 200 && x.consumed.body.authorization_consumed === true && x.consumed.body.execution_authorized === true
    && x.receipt?.status === 'succeeded' && x.receipt.review_id === r.review_id && x.receipt.request_id === r.request_id
    && x.receipt.decision_id === r.decision_id && x.receipt.evaluation_id === r.evaluation_id
    && indices.every((n: number, i: number) => n >= 0 && (!i || n > indices[i-1]))
    && x.audit.every((a: any) => x.after.events.some((row: any) => same({ ...row.record, sequence: row.sequence }, a)))
    && types.filter(type => type.startsWith('review.')).every(type => {
      const a = x.audit.find((a: any) => a.event_type === type);
      return a.review_id === r.review_id && a.evaluation_id === r.evaluation_id
        && (type === 'review.requested' || a.reviewer_principal_id === r.reviewer_principal_id);
    })
    && x.before.ledger.length === 0 && x.after.ledger.length === 1 && same(x.after.ledger[0], x.receipt)
    && !x.before.file.exists && x.after.file.content === 'deterministic governance fixture\n'
    && x.after.reviews.length === 1 && same(x.after.reviews[0], r)
    && e.a.mode === 'create' && e.b.mode === 'reopen' && e.a.pid > 0 && e.b.pid > 0 && e.a.pid !== e.b.pid
    && e.exitA.pid === e.a.pid && e.exitA.code === 0 && e.exitA.signal === null && e.exitB.pid === e.b.pid && e.exitB.code === 0 && e.exitB.signal === null
    && x.pid === e.a.pid && y.pid === e.b.pid
    && same(e.trace, ['A-spawn','A-ready','consumption-and-execution-observed','A-exited','B-spawn','B-ready','replay-observed','B-exited'])
    && same(e.a.identity, e.b.identity) && same(x.body, e.a.identity.body) && same(x.body, y.body)
    && r.principal_id === e.a.identity.principal && r.agent_id === e.a.identity.agent
    && r.binding.session_id === y.body.session_id && r.binding.speaker_id === y.body.speaker_id
    && same(x.after, e.b.snapshot) && same(e.b.snapshot, y.before) && same(y.before, y.after)
    && same(e.a.snapshot.database, e.b.snapshot.database) && same(e.a.snapshot.sandbox, e.b.snapshot.sandbox)
    && same(e.a.snapshot.metadata, e.b.snapshot.metadata)
    && y.inspected.status === 200 && same(y.inspected.body, r) && y.review.status === 200 && same(y.review.body, r)
    && y.path === `/reviews/${r.review_id}/execute` && y.response.status === 409
    && typeof y.response.requestId === 'string' && ![x.held.requestId,x.approval.requestId,x.consumed.requestId].includes(y.response.requestId)
    && y.response.body.authority_decision === undefined && y.response.body.execution_authorized !== true
    && !y.audit.some((a: any) => a.event_type.startsWith('tool.execution.') || a.event_type === 'authority.decision' || a.event_type === 'cde.signal.created')
    && timeline.filter(r => r.category === 'governance').length === 1;
  return result(!!passed);
};
