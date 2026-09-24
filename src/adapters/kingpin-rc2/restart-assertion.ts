import { isDeepStrictEqual } from 'node:util';
import type { Invariant } from '../../core/assertions.ts';
export const restartInvariant: Invariant = timeline => {
  const records = timeline.filter(r => r.category === 'governance');
  const initial = records.find(r => r.data.requestId === 'restart-before'), later = records.find(r => r.data.requestId === 'restart-after');
  const e = later?.data.evidence.rc2_restart as any;
  const result = (passed: boolean) => ({ invariantId: 'capability_revocation_survives_restart', name: 'Capability revocation survives restart', passed,
    reason: passed ? 'A completed a real write and durably revoked capability; after A exited, B reopened the same state and freshly denied execution without a second effect.'
      : 'Missing or inconsistent process replacement, durable revocation, identity, fresh evaluation or no-effect evidence.', evidence: [initial,later].flatMap(r => r ? [r.sequence] : []) });
  if (!initial || !later || !e?.a || !e.b || !e.exitA || !e.exitB || !e.revocation) return result(false);
  const x = e.first, y = e.observation, rev = e.revocation;
  const same = isDeepStrictEqual;
  const event = (obs: any, type: string) => obs.audit.find((r: any) => r.event_type === type);
  const d1 = event(x, 'authority.decision'), d2 = event(y, 'authority.decision'), revoked = event(rev, 'capability.revoked');
  const seq = (event: any) => y.after.events.find((r: any) => r.record.event_id === event?.event_id)?.sequence;
  const fresh = (obs: any, record: any) => {
    const d = event(obs, 'authority.decision'), c = event(obs, 'cde.signal.created');
    return d && c && typeof d.evaluation_id === 'string' && typeof d.decision_id === 'string'
      && obs.request.requestId === record.data.requestId && d.decision_id === record.data.decisionId
      && c.request_id === obs.response.requestId && d.request_id === obs.response.requestId
      && c.decision_id === d.decision_id && c.evaluation_id === d.evaluation_id
      && obs.response.body.top_event?.event_id === d.evaluation_id && obs.response.body.authority_decision.evaluation_id === d.evaluation_id
      && c.principal_id === obs.request.principal && d.principal_id === obs.request.principal
      && c.agent_id === obs.request.agent && d.agent_id === obs.request.agent
      && obs.audit.indexOf(c) < obs.audit.indexOf(d);
  };
  const passed = !!d1 && !!d2 && !!revoked && initial.sequence < later.sequence
    && initial.data.result === 'ALLOW' && later.data.result === 'DENY' && fresh(x, initial) && fresh(y, later)
    && d1.outcome === 'allow' && d2.outcome === 'deny' && d2.reason_codes.includes('CAPABILITY_REVOKED')
    && d1.decision_id !== d2.decision_id && d1.evaluation_id !== d2.evaluation_id && x.response.requestId !== y.response.requestId
    && x.receipt?.status === 'succeeded' && x.receipt.request_id === x.response.requestId && x.receipt.decision_id === d1.decision_id
    && x.before.ledger.length === 0 && x.after.ledger.length === 1 && same(x.after.ledger[0], x.receipt)
    && !x.before.file.exists && x.after.file.content === 'deterministic governance fixture\n'
    && ['tool.enforcement.allowed','tool.execution.started','tool.execution.succeeded'].every(type => {
      const r = event(x, type); return r?.request_id === x.response.requestId && r.decision_id === d1.decision_id;
    })
    && rev.pid === e.a.pid && rev.response.status === 200 && rev.response.body.revoked === true
    && rev.response.body.target.tool === 'fs.write' && revoked.tool_id === 'fs.write' && revoked.request_id === rev.response.requestId
    && same(rev.response.body.context, d1.context) && same(revoked.context, d1.context) && same(d1.context, d2.context)
    && rev.snapshot.revocations.some((r: any) => r.tool === 'fs.write' && same(JSON.parse(r.context_key), d1.context))
    && seq(event(x, 'tool.execution.succeeded')) < seq(revoked) && seq(revoked) < seq(event(y, 'cde.signal.created'))
    && e.a.mode === 'create' && e.b.mode === 'reopen' && Number.isInteger(e.a.pid) && e.a.pid > 0 && Number.isInteger(e.b.pid) && e.b.pid > 0 && e.a.pid !== e.b.pid
    && e.exitA.pid === e.a.pid && e.exitA.code === 0 && e.exitA.signal === null
    && e.exitB.pid === e.b.pid && e.exitB.code === 0 && e.exitB.signal === null
    && x.pid === e.a.pid && y.pid === e.b.pid
    && same(e.trace, ['A-spawn','A-ready','control-observed','revocation-acknowledged','A-exited','B-spawn','B-ready','post-observed','B-exited'])
    && same(e.a.identity, e.b.identity) && x.request.principal === y.request.principal && x.request.agent === y.request.agent
    && same(x.input.args, y.input.args) && x.input.tool === y.input.tool && y.input.tool === 'fs.write'
    && x.input.plan_id !== y.input.plan_id
    && same(e.a.snapshot.database, e.b.snapshot.database) && same(e.a.snapshot.sandbox, e.b.snapshot.sandbox)
    && same(e.a.snapshot.metadata, e.b.snapshot.metadata)
    && same(rev.snapshot, e.b.snapshot) && same(e.b.snapshot, y.before)
    && same(y.before.revocations, y.after.revocations)
    && same(y.after.events.slice(0, y.before.events.length), y.before.events)
    && y.after.events.slice(y.before.events.length).every((r: any) => r.record.request_id === y.response.requestId)
    && same(x.after.ledger, rev.snapshot.ledger) && same(y.before.ledger, y.after.ledger)
    && same(x.after.file, rev.snapshot.file) && same(y.before.file, y.after.file)
    && y.receipt === null && event(y, 'tool.enforcement.denied')?.request_id === y.response.requestId
    && !y.audit.some((r: any) => r.event_type.startsWith('tool.execution.'))
    && timeline.some(r => r.category === 'execution' && r.data.requestId === 'restart-after' && r.data.status === 'NOT_STARTED');
  return result(!!passed);
};
