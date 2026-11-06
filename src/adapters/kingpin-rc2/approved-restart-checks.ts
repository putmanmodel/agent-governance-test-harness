import { isDeepStrictEqual as same } from 'node:util';
import { bindingHash, requestBinding, expectedApprovedBody } from './approved-restart-binding.ts';
import type { TimelineRecord } from '../../core/timeline.ts';
const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: any) => typeof v === 'string' && v.length > 0;
const hash = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = (v: any) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const records = (v: any) => Array.isArray(v) && v.every(object);
export const snapshotsOf = (e: any) => [e.a.snapshot, e.first.before, e.first.approved, e.first.after,
  e.b.snapshot, e.replay.before, e.replay.after, e.final];
export const withoutObserver = ({ observer, ...s }: any) => s;
export function evidenceShape(e: any): boolean {
  const event = (a: any) => object(a) && text(a.event_type) && text(a.event_id) && text(a.request_id)
    && ['1.0', '2.0', '3.0'].includes(a.schema_version) && date(a.timestamp_utc)
    && Array.isArray(a.reason_codes) && a.reason_codes.every(text);
  const review = (r: any) => object(r) && ['pending','approved','invalidated','denied','consumed'].includes(r.status)
    && ['review_id','request_id','decision_id','evaluation_id','principal_id','agent_id','tool_id'].every(k => text(r[k]))
    && r.schema_version === '1.0' && !('execution_id' in r) && !('receipt' in r)
    && object(r.binding) && hash(r.binding_hash) && hash(r.policy_fingerprint) && object(r.context)
    && date(r.created_at) && (r.status === 'pending' ? r.execution === null : object(r.execution)
      && typeof r.execution.eligible === 'boolean' && text(r.execution.reason) && date(r.execution.checked_at))
    && (r.consumed_at === null || date(r.consumed_at))
    && object(r.original_envelope) && Array.isArray(r.original_envelope.tools) && Array.isArray(r.original_envelope.revoked_tools)
    && Array.isArray(r.signal_reason_codes) && Array.isArray(r.original_reason_codes);
  return snapshotsOf(e).every(s => object(s) && records(s.ledger) && s.ledger.every((r: any) => text(r.execution_id) && text(r.status))
    && records(s.calls) && records(s.observer) && s.observer.every((r: any) => Number.isSafeInteger(r.pid) && ['ready','execute'].includes(r.type))
    && records(s.events) && s.events.every((a: any) => event(a) && Number.isSafeInteger(a.sequence))
    && records(s.reviews) && s.reviews.every(review) && records(s.revocations) && records(s.metadata)
    && object(s.file) && s.file.source === 'harness' && typeof s.file.exists === 'boolean'
    && (!s.file.exists || typeof s.file.content === 'string')
    && [s.database, s.sandbox].every(i => object(i) && Number.isSafeInteger(i.dev) && Number.isSafeInteger(i.ino)))
    && [e.first.audit, e.first.revocationAudit, e.replay.audit, e.replay.originalAudit].every(a => Array.isArray(a) && a.every(event))
    && [e.first.pending.body, e.first.approval.body.review, e.first.review.body, e.replay.inspected.body, e.replay.review.body].every(review);
}
export function qualificationChecks(timeline: readonly TimelineRecord[], e: any): Record<string, boolean> {
  const x = e.first, y = e.replay, r = x.approval.body.review, after = y.review.body;
  const snapshots = snapshotsOf(e), events = y.after.events;
  const decision = events.filter((a: any) => a.event_type === 'authority.decision');
  const native = x.held.body.authority_decision;
  const originalReviews = [x.pending.body, r, x.review.body, y.inspected.body, after, ...snapshots.flatMap(s => s.reviews)];
  const lifecycle = (a: any) => a.event_type.startsWith('tool.execution.')
    || ['review.execution_authorized', 'review.execution_consumed', 'tool.enforcement.allowed'].includes(a.event_type);
  const exec = timeline.filter(r => r.category === 'execution'), enforcement = timeline.filter(r => r.category === 'enforcement');
  const governance = timeline.filter(r => r.category === 'governance');
  const p = e.provenance;
  return {
    request_binding: same(x.body, expectedApprovedBody(timeline[0].scenarioId))
      && same(requestBinding(y.body, r.principal_id), r.binding)
      && originalReviews.every(v => same(v.binding, r.binding) && bindingHash(v.binding) === v.binding_hash)
      && bindingHash(requestBinding(y.body, r.principal_id)) === r.binding_hash
      && [e.a.nativeBinding, e.b.nativeBinding, y.nativeBinding].every(b => same(b, r.binding))
      && r.tool_id === r.binding.tool_id && r.principal_id === r.binding.principal_id && r.agent_id === r.binding.agent_id
      && same(r.context, { session_id: r.binding.session_id, speaker_id: r.binding.speaker_id, channel_id: r.binding.channel_id,
        scope_key: `scene:${r.binding.scene_id}` }),
    initial_native_audit: decision.length === 1 && decision[0].outcome === 'human_review'
      && decision[0].request_id === r.request_id && decision[0].decision_id === r.decision_id
      && decision[0].evaluation_id === r.evaluation_id && decision[0].principal_id === r.principal_id
      && decision[0].agent_id === r.agent_id && decision[0].tool_id === r.tool_id
      && same(decision[0].context, r.context) && same(decision[0].reason_codes, native.reason_codes)
      && decision[0].reason_codes.includes(native.reason.toUpperCase())
      && x.audit.some((a: any) => same(a, decision[0]))
      && decision[0].sequence < events.find((a: any) => a.event_type === 'review.requested')?.sequence,
    review_transition: r.execution.reason === 'ALLOWED' && r.execution.checked_at === r.resolved_at
      && r.resolution_reason === 'REVIEWER_APPROVED' && r.original_outcome === 'human_review'
      && r.cde_gate === 1 && same(r.signal_reason_codes, ['LOW_CONFIDENCE'])
      && r.original_envelope.tools.includes('fs.write') && !r.original_envelope.revoked_tools.includes('fs.write')
      && snapshots.every(s => s.metadata.length === 1 && s.metadata[0].policy_fingerprint === r.policy_fingerprint)
      && !snapshots.slice(0, 6).some(s => s.events.some((a: any) => a.event_type === 'review.invalidated'))
      && events.filter((a: any) => a.event_type === 'review.invalidated').length === 1
      && Date.parse(after.execution.checked_at) >= Date.parse(r.execution.checked_at),
    exclusive_timeline: governance.length === 1 && exec.length === 1 && enforcement.length === 1
      && exec[0].data.status === 'NOT_STARTED' && exec[0].data.requestId === governance[0].data.requestId
      && enforcement[0].data.result === 'BLOCK' && enforcement[0].data.requestId === governance[0].data.requestId
      && enforcement[0].data.decisionId === governance[0].data.decisionId
      && !timeline.some(row => 'execution_id' in row.data || 'executionId' in row.data || 'receipt' in row.data)
      && [x.held.body, x.approval.body, y.response.body].every(b => b.execution_id === undefined && b.receipt === undefined),
    // These four predicates are intentionally independent of snapshot consistency.
    zero_ledger: snapshots.every(s => s.ledger.length === 0),
    zero_execution_events: snapshots.every(s => !s.events.some(lifecycle))
      && [x.audit, x.revocationAudit, y.audit, y.originalAudit].every(a => !a.some(lifecycle)),
    zero_adapter_calls: snapshots.every(s => s.calls.length === 0),
    zero_filesystem_effect: snapshots.every(s => s.file.exists === false),
    observer_ready: snapshots.every((s, i) => same(s.observer.filter((r: any) => r.type === 'ready'),
      [{ type: 'ready', pid: e.a.pid, mode: 'create', hook: 'beforeEffect' },
        ...(i >= 4 ? [{ type: 'ready', pid: e.b.pid, mode: 'reopen', hook: 'beforeEffect' }] : [])])
      && same(s.calls, s.observer.filter((r: any) => r.type === 'execute'))),
    provenance: p.schemaVersion === 1 && p.scenarioId === timeline[0].scenarioId && p.adapter === 'kingpin-rc2-gateway'
      && p.runtime.source === 'repository-source' && text(p.runtime.root) && /^[a-f0-9]{40}$/.test(p.runtime.repository.commit)
      && typeof p.runtime.repository.dirty === 'boolean' && Array.isArray(p.runtime.repository.changedFiles)
      && object(p.runtime.files) && Object.keys(p.runtime.files).length > 17 && Object.values(p.runtime.files).every(hash)
      && text(p.runtime.node) && text(p.runtime.platform) && text(p.runtime.architecture) && text(p.runtime.sqlite)
      && same(p.runtime, e.a.runtime) && same(p.runtime, e.b.runtime)
      && same(p.runtime, p.runtimeAfterA) && same(p.runtime, p.runtimeAfterB)
      && text(p.harness.repository.commit) && typeof p.harness.repository.dirty === 'boolean'
      && Array.isArray(p.harness.repository.changedFiles) && object(p.harness.files) && Object.values(p.harness.files).every(hash)
      && (!p.sdkEquivalence.established || p.sdkEquivalence.version === '0.1.0-rc.3'
        && p.sdkEquivalence.archiveSha256 === '7207254ae3621aeba68e437b51e602a359c6a2fd8a06038fd07a94a787e2f4a8'
        && p.sdkEquivalence.archiveSha256 === p.sdkEquivalence.expectedArchiveSha256
        && Object.keys(p.sdkEquivalence.files).length === 17
        && Object.entries(p.sdkEquivalence.files).every(([path, v]: [string, any]) => hash(v.archiveSha256)
          && v.archiveSha256 === v.sourceSha256 && v.sourceSha256 === p.runtime.files[`kingpin/${path}`])),
  };
}
