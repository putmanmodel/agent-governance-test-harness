import type { Invariant } from '../../core/assertions.ts';
import type { ExecutionStatus } from '../../core/events.ts';
// These are native RC2 observations, not generic scheduling/cancellation contracts.
export type NativeRecord = Record<string, any>;
export interface Snapshot { events: { sequence: number; record: NativeRecord }[]; ledger: NativeRecord[]; fileExists: boolean }
export interface FlightEvidence {
  sources: Record<string, string>;
  cancellation_supported: false;
  cancellation_claimed: boolean;
  reportedDisposition: string;
  trace: { sequence: number; event: string; elapsedMs: number }[];
  started: Snapshot;
  held: Snapshot;
  revocation: { status: number; requestId: string; body: NativeRecord };
  acknowledgementWhileHeld: boolean;
  first: { response: NativeRecord; audit: NativeRecord[]; receipt: NativeRecord; ledger: NativeRecord[]; file: NativeRecord };
  afterFirst: Snapshot;
  later?: NativeRecord;
  afterLater?: Snapshot;
}
export const nativeDisposition: Record<string, ExecutionStatus> = {
  succeeded: 'SUCCEEDED', failed: 'FAILED', unknown: 'UNKNOWN',
  reconciled_succeeded: 'SUCCEEDED', reconciled_failed: 'FAILED', reconciliation_required: 'UNKNOWN',
};

export const inFlightInvariant: Invariant = timeline => {
  const governance = timeline.filter(r => r.category === 'governance');
  const initial = governance.find(r => r.data.requestId === 'in-flight-first');
  const redispatch = governance.find(r => r.data.requestId === 'in-flight-later');
  const e = redispatch?.data.evidence.rc2_in_flight as FlightEvidence | undefined;
  const fail = (passed: boolean) => ({ invariantId: 'in_flight_revocation_preserves_execution_truth',
    name: 'In-flight revocation preserves execution truth', passed,
    reason: passed ? 'Native start preceded revocation attempt; disposition is preserved without claiming cancellation; acknowledged revocation governed fresh redispatch with no second execution.'
      : 'Missing or inconsistent start/revocation/disposition ordering, fresh governance, or no-second-execution evidence.',
    evidence: [initial, redispatch].flatMap(r => r ? [r.sequence] : []) });
  if (!initial || !redispatch || !e?.first?.receipt || !e.later || !e.afterLater) return fail(false);
  const id = e.first.receipt.execution_id, requestId = e.first.response.requestId;
  const firstDecision = e.first.audit.find(r => r.event_type === 'authority.decision');
  const laterDecision = e.later.audit.find((r: NativeRecord) => r.event_type === 'authority.decision');
  const signal = e.later.audit.find((r: NativeRecord) => r.event_type === 'cde.signal.created');
  const start = e.started.events.find(r => r.record.event_type === 'tool.execution.started' && r.record.execution_id === id);
  const authorized = e.started.events.find(r => r.record.event_type === 'authority.decision' && r.record.request_id === requestId);
  const dispatch = e.started.events.find(r => r.record.event_type === 'tool.enforcement.allowed' && r.record.request_id === requestId);
  const revoked = e.afterFirst.events.find(r => r.record.event_type === 'capability.revoked' && r.record.request_id === e.revocation.requestId);
  const disposition = e.afterFirst.events.find(r => r.record.event_type === `tool.execution.${e.first.receipt.status}` && r.record.execution_id === id);
  const traceIndex = (name: string) => e.trace.findIndex(r => r.event === name);
  const order = ['start-observed', 'revocation-attempt', 'revocation-request-sent', 'acknowledgement-pending', 'barrier-release', 'revocation-acknowledged', 'later-request', 'later-response']
    .map(traceIndex);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const retryEvent = timeline.find(r => r.category === 'scenario' && r.data.type === 'RETRY' && r.data.requestId === 'in-flight-later');
  const passed = !!start && !!authorized && !!dispatch && !!revoked && !!disposition && !!firstDecision && !!laterDecision && !!signal
    && initial.data.result === 'ALLOW' && redispatch.data.result === 'DENY' && laterDecision.outcome === 'deny'
    && initial.sequence < redispatch.sequence
    && retryEvent?.category === 'scenario' && retryEvent.data.type === 'RETRY'
    && retryEvent.data.payload.request.provenance.retryOf === initial.data.requestId
    && authorized.record.outcome === 'allow' && authorized.sequence < dispatch.sequence && dispatch.sequence < start.sequence
    && start.record.request_id === requestId && start.record.decision_id === initial.data.decisionId
    && firstDecision.decision_id === initial.data.decisionId
    && e.started.ledger.length === 1 && e.started.ledger[0].status === 'started' && e.started.ledger[0].execution_id === id
    && same(e.started, e.held) && e.held.fileExists === false
    && order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1]))
    && e.trace.every((r, i) => r.sequence === i + 1 && Number.isFinite(r.elapsedMs) && (i === 0 || r.elapsedMs >= e.trace[i - 1].elapsedMs))
    && e.acknowledgementWhileHeld === false
    && e.cancellation_supported === false && e.cancellation_claimed === false
    && !!nativeDisposition[e.first.receipt.status] && e.reportedDisposition === e.first.receipt.status
    && start.sequence < disposition.sequence && disposition.sequence < revoked.sequence
    && disposition.record.request_id === requestId && disposition.record.decision_id === initial.data.decisionId
    && e.first.receipt.request_id === requestId && e.first.receipt.decision_id === initial.data.decisionId
    && e.first.ledger.length === 1 && same(e.first.ledger[0], e.first.receipt)
    && e.revocation.status === 200 && e.revocation.body.revoked === true
    && revoked.record.context?.speaker_id === firstDecision.agent_id
    && e.revocation.body.target?.tool === firstDecision.tool_id
    && same(e.revocation.body.context, firstDecision.context)
    && revoked.record.tool_id === firstDecision.tool_id
    && !e.started.events.some(r => r.record.event_type === 'capability.revoked')
    && e.later.response.requestId !== requestId && laterDecision.request_id === e.later.response.requestId
    && laterDecision.decision_id === redispatch.data.decisionId && laterDecision.decision_id !== initial.data.decisionId
    && laterDecision.evaluation_id !== firstDecision.evaluation_id
    && signal.request_id === laterDecision.request_id && signal.evaluation_id === laterDecision.evaluation_id
    && signal.decision_id === laterDecision.decision_id
    && e.later.response.body.authority_decision?.evaluation_id === laterDecision.evaluation_id
    && signal.principal_id === firstDecision.principal_id && laterDecision.agent_id === firstDecision.agent_id
    && laterDecision.principal_id === firstDecision.principal_id && signal.agent_id === firstDecision.agent_id
    && same(e.afterFirst.ledger, e.first.ledger) && same(e.afterLater.ledger, e.later.after.ledger)
    && e.afterLater.events.some(r => r.record.event_id === laterDecision.event_id && r.sequence > revoked.sequence)
    && e.later.audit.some((r: NativeRecord) => r.event_type === 'tool.enforcement.denied' && r.request_id === laterDecision.request_id)
    && !e.later.audit.some((r: NativeRecord) => r.event_type.startsWith('tool.execution.'))
    && e.later.receipt === null && same(e.first.ledger, e.later.before.ledger) && same(e.later.before.ledger, e.later.after.ledger)
    && same(e.first.file, e.later.before.file) && same(e.later.before.file, e.later.after.file)
    && timeline.some(r => r.category === 'execution' && r.data.requestId === 'in-flight-first' && r.data.status === nativeDisposition[e.first.receipt.status])
    && timeline.some(r => r.category === 'execution' && r.data.requestId === 'in-flight-later' && r.data.status === 'NOT_STARTED');
  return fail(passed);
};
