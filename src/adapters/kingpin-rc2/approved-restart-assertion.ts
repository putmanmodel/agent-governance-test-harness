import { isDeepStrictEqual as same } from 'node:util';
import { evidenceShape, qualificationChecks, withoutObserver } from './approved-restart-checks.ts';
import type { TimelineRecord } from '../../core/timeline.ts';
import type { Invariant } from '../../core/assertions.ts';
export function approvedRestartChecks(timeline: readonly TimelineRecord[]): Record<string, boolean> {
  const record = timeline.find(r => r.category === 'governance');
  try {
    if (record?.category !== 'governance') return { evidence_shape: false };
    const e = record.data.evidence.rc2_approved_restart as any;
    if (!evidenceShape(e)) return { evidence_shape: false };
    const checks = qualificationChecks(timeline, e);
    const x = e.first, y = e.replay, r = x.approval.body.review, after = y.review.body;
    const events = y.after.events;
    const requested = events.find((a: any) => a.event_type === 'review.requested');
    const approved = events.find((a: any) => a.event_type === 'review.approved');
    const revoked = events.find((a: any) => a.event_type === 'capability.revoked');
    const invalidated = events.find((a: any) => a.event_type === 'review.invalidated');
    const history = ['resolved_at', 'reviewer_principal_id', 'resolution', 'resolution_reason'];
    const unchanged = Object.keys(r).filter(k => !['status', 'execution'].includes(k));
    const passed = record.data.result === 'INDETERMINATE' && record.data.decisionId === r.decision_id
      && record.data.rationale === x.held.body.authority_decision.reason
      && x.held.status === 428 && x.held.body.authority_decision.outcome === 'human_review'
      && x.held.reviewId === r.review_id && x.held.requestId === r.request_id
      && x.held.body.top_event.event_id === r.evaluation_id
      && x.held.body.authority_decision.evaluation_id === r.evaluation_id
      && x.pending.status === 200 && x.pending.body.status === 'pending'
      && x.pending.body.review_id === r.review_id && same(x.pending.body.binding, r.binding)
      && x.pending.body.binding_hash === r.binding_hash
      && x.approval.status === 200 && x.approval.body.ready_for_consumption === true
      && x.approval.body.execution_authorized === false && r.status === 'approved'
      && r.execution.eligible === true && r.consumed_at === null && r.resolution === 'approve'
      && r.reviewer_principal_id === 'harness-reviewer' && r.reviewer_principal_id !== r.principal_id
      && Number.isFinite(Date.parse(r.resolved_at)) && history.every(k => r[k] !== null)
      && same(x.approved.reviews, [r]) && x.review.status === 200 && same(x.review.body, r)
      && same(x.after.reviews, [r]) && x.approved.revocations.length === 0
      && x.revoke.status === 200 && x.revoke.body.revoked === true && x.revoke.body.target.tool === 'fs.write'
      && same(x.revoke.body.context, r.context) && revoked.tool_id === 'fs.write'
      && revoked.request_id === x.revoke.requestId && same(revoked.context, r.context)
      && revoked.reason_codes.includes('CAPABILITY_REVOKED')
      && x.revocationAudit.some((a: any) => same(a, revoked))
      && x.after.revocations.length === 1 && x.after.revocations[0].tool === 'fs.write'
      && same(JSON.parse(x.after.revocations[0].context_key), r.context)
      && requested.sequence < approved.sequence && approved.sequence < revoked.sequence && revoked.sequence < invalidated?.sequence
      && [requested, approved, invalidated].every(a => a?.review_id === r.review_id && a.request_id === r.request_id
        && a.decision_id === r.decision_id && a.evaluation_id === r.evaluation_id)
      && [approved, invalidated].every(a => a.reviewer_principal_id === r.reviewer_principal_id)
      && e.a.mode === 'create' && e.b.mode === 'reopen' && e.a.pid > 0 && e.b.pid > 0 && e.a.pid !== e.b.pid
      && e.exitA.pid === e.a.pid && e.exitA.code === 0 && e.exitA.signal === null
      && e.exitB.pid === e.b.pid && e.exitB.code === 0 && e.exitB.signal === null
      && x.pid === e.a.pid && y.pid === e.b.pid
      && same(e.trace, ['A-spawn','A-ready','approval-and-revocation-observed','A-exited','B-spawn','B-ready','replay-observed','B-exited'])
      && same(e.a.identity, e.b.identity) && same(x.body, e.a.identity.body) && same(x.body, y.body)
      && !('lease_token' in x.body) && x.body.tool === 'fs.write'
      && r.principal_id === e.a.identity.principal && r.agent_id === e.a.identity.agent
      && same(e.a.snapshot.database, e.b.snapshot.database) && same(e.a.snapshot.sandbox, e.b.snapshot.sandbox)
      && same(e.a.snapshot.metadata, e.b.snapshot.metadata)
      && same(withoutObserver(x.after), withoutObserver(e.b.snapshot)) && same(e.b.snapshot, y.before) && same(y.after, e.final)
      && same(y.before.revocations, y.after.revocations) && same(y.before.metadata, y.after.metadata)
      && same(y.before.database, y.after.database) && same(y.before.sandbox, y.after.sandbox)
      && y.inspected.status === 200 && same(y.inspected.body, r)
      && y.path === `/reviews/${r.review_id}/execute` && y.response.status === 403
      && y.response.body.review_id === r.review_id && y.response.body.execution_authorized === false
      && y.response.body.reason === 'CAPABILITY_REVOKED' && y.response.body.authority_decision === undefined
      && y.response.body.execution_id === undefined && y.receipt === null
      && typeof y.response.requestId === 'string' && y.response.requestId.length > 0
      && ![x.held.requestId, x.approval.requestId, x.revoke.requestId].includes(y.response.requestId)
      && y.review.status === 200 && after.status === 'invalidated' && after.execution.eligible === false
      && after.execution.reason === 'CAPABILITY_REVOKED' && Number.isFinite(Date.parse(after.execution.checked_at))
      && after.consumed_at === null && unchanged.every(k => same(r[k], after[k]))
      && same(y.after.reviews, [after]) && invalidated?.reason_codes.includes('CAPABILITY_REVOKED')
      && same(y.after.events.slice(0, y.before.events.length), y.before.events)
      && same(y.after.events.slice(y.before.events.length), [invalidated])
      && same(y.originalAudit, events.filter((a: any) => a.request_id === r.request_id))
      && same(y.audit, events.filter((a: any) => a.request_id === y.response.requestId))
      && x.audit.every((a: any) => x.after.events.some((b: any) => same(a, b)))
      && timeline.filter(r => r.category === 'governance').length === 1
      && timeline.some(r => r.category === 'enforcement' && r.data.result === 'BLOCK')
      && timeline.some(r => r.category === 'execution' && r.data.status === 'NOT_STARTED');
    return { evidence_shape: true, ...checks, lifecycle_continuity: !!passed };
  } catch { return { evidence_shape: false }; }
};

export const approvedRestartInvariant: Invariant = timeline => {
  const checks = approvedRestartChecks(timeline), failed = Object.keys(checks).filter(k => !checks[k]);
  const record = timeline.find(r => r.category === 'governance');
  return { invariantId: 'approved_review_revocation_survives_restart',
    name: 'Approved review cannot bypass durable capability revocation', passed: failed.length === 0,
    reason: failed.length ? `Qualification checks failed: ${failed.join(', ')}`
      : 'Valid bound approval, durable revocation and graceful process replacement; specific refusal with zero execution and bounded target effects.',
    evidence: record ? [record.sequence] : [] };
};
