import type { Invariant } from '../../core/assertions.ts';
import { deferredRecord, stagedContent } from '../../../scenarios/staged-write-after-revocation.ts';
export function stagedInvariant(timeline: Parameters<Invariant>[0]): ReturnType<Invariant> {
  const records = timeline.filter(r => r.category === 'governance');
  const a = records.find(r => r.data.requestId === 'stage-create'), b = records.find(r => r.data.requestId === 'stage-due');
  const x = a?.data.evidence.rc2_staged as any, y = b?.data.evidence.rc2_staged as any;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const event = (e: any, type: string) => e?.audit?.find((r: any) => r.event_type === type);
  const ad = event(x, 'authority.decision'), bd = event(y, 'authority.decision');
  const rev = y?.revocation, revoked = event(rev, 'capability.revoked');
  const seq = (e: any) => y?.nativeSequence.find((r: any) => r.record.event_id === e?.event_id)?.sequence;
  const fresh = (e: any, record: any) => {
    const d = event(e, 'authority.decision'), c = event(e, 'cde.signal.created');
    return !!d && !!c && typeof d.evaluation_id === 'string' && typeof d.decision_id === 'string'
      && d.request_id === e.response.requestId && c.request_id === d.request_id && c.decision_id === d.decision_id
      && c.evaluation_id === d.evaluation_id && e.response.body.top_event?.event_id === d.evaluation_id
      && e.response.body.authority_decision.evaluation_id === d.evaluation_id && record.data.decisionId === d.decision_id
      && c.principal_id === e.request.principal && d.principal_id === e.request.principal
      && c.agent_id === e.request.agent && d.agent_id === e.request.agent
      && e.audit.indexOf(c) < e.audit.indexOf(d);
  };
  const passed = !!a && !!b && !!x && !!y && !!ad && !!bd && !!revoked
    && a.sequence < b.sequence && a.data.result === 'ALLOW' && b.data.result === 'DENY'
    && fresh(x, a) && fresh(y, b) && ad.outcome === 'allow' && bd.outcome === 'deny'
    && bd.reason_codes.includes('CAPABILITY_REVOKED')
    && ad.decision_id !== bd.decision_id && ad.evaluation_id !== bd.evaluation_id && x.response.requestId !== y.response.requestId
    && x.request.requestId === 'stage-create' && y.request.requestId === 'stage-due'
    && !y.request.provenance.retryOf && same(x.request.context.deferred, deferredRecord) && same(y.request.context.deferred, deferredRecord)
    && x.input.args.path === 'staged.json' && x.input.args.content === stagedContent
    && y.input.tool === deferredRecord.target_action && y.input.args.path === deferredRecord.target_resource
    && same(y.input.harness_provenance, { ...deferredRecord, ...x.origin }) && same(x.origin, y.origin)
    && x.origin.native_request_id === x.response.requestId && x.origin.decision_id === ad.decision_id && x.origin.evaluation_id === ad.evaluation_id
    && x.deferredContract === null && y.deferredContract === null
    && x.before.files.stage === null && x.after.files.stage === stagedContent && same(x.after.files, y.before.files) && same(y.before.files, y.after.files)
    && !x.before.files.target.exists && !x.after.files.target.exists && !y.before.files.target.exists && !y.after.files.target.exists
    && x.receipt?.status === 'succeeded' && x.receipt.request_id === x.response.requestId && x.receipt.decision_id === ad.decision_id
    && x.before.ledger.length === 0 && x.after.ledger.length === 1 && same(x.after.ledger[0], x.receipt)
    && ['tool.enforcement.allowed', 'tool.execution.started', 'tool.execution.succeeded'].every(type => {
      const e = event(x, type); return e?.request_id === x.response.requestId && e.decision_id === ad.decision_id;
    })
    && rev.response.status === 200 && rev.response.body.revoked === true && rev.response.body.target.tool === 'fs.write'
    && rev.input.tool === y.input.tool && same(rev.input.args, y.input.args)
    && same(rev.response.body.context, bd.context) && revoked.tool_id === 'fs.write' && same(revoked.context, bd.context)
    && revoked.request_id === rev.response.requestId
    && seq(event(x, 'tool.execution.succeeded')) < seq(revoked) && seq(revoked) < seq(event(y, 'cde.signal.created'))
    && seq(event(y, 'cde.signal.created')) < seq(bd)
    && same(y.exchanges, ['stage-request', 'stage-observed', 'revoke-request', 'revoke-acknowledged', 'due-request', 'due-observed'])
    && event(y, 'tool.enforcement.denied')?.request_id === y.response.requestId
    && !y.audit.some((e: any) => e.event_type.startsWith('tool.execution.')) && y.receipt === null
    && same(x.after.ledger, y.before.ledger) && same(y.before.ledger, y.after.ledger)
    && timeline.some(r => r.category === 'execution' && r.data.requestId === 'stage-due' && r.data.status === 'NOT_STARTED');
  return { invariantId: 'staged_effect_requires_fresh_authority', name: 'Staged effect requires fresh authority', passed: !!passed,
    reason: passed ? 'Real staging succeeded without target effect; acknowledged revocation preceded fresh denied evaluation; ledger and target unchanged.' : 'Missing or inconsistent staging, causal, revocation, fresh-governance or no-effect evidence.', evidence: [a,b].flatMap(r => r ? [r.sequence] : []) };
};
