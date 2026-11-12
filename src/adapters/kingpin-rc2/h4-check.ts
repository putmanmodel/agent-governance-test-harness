import assert from 'node:assert/strict';
import type { contractionCases } from '../../../scenarios/registrations.ts';
import { bindingHash, canonical, expectedApprovedBody, requestBinding } from './approved-restart-binding.ts';
import { verifyRestart } from './h3-sqlite-check.ts';

type Native = Record<string, any>;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function state({ seq, ...rest }: Native) { return rest; }
function noExecution(sample: Native) {
  assert.deepEqual(sample.ledger, [], 'execution ledger');
  assert.deepEqual(sample.directory, ['seed.txt'], 'bounded directory');
  assert.deepEqual(sample.file, { source: 'harness', exists: false }, 'bounded target');
  assert.ok(Array.isArray(sample.events) && sample.events.every((v: Native) =>
    !v.event_type.startsWith('tool.execution.') && !['review.execution_authorized','review.execution_consumed'].includes(v.event_type)), 'execution history');
}
function nativeEvent(events: Native[], type: string, request?: string) {
  const matches = events.filter(v => v.event_type === type && (!request || v.request_id === request));
  assert.equal(matches.length, 1, type);
  return matches[0];
}

export function verifyContraction(id: typeof contractionCases[number], e: Native) {
  const { readyA, readyB, pids } = verifyRestart(e);
  const first = e.a.observed, second = e.b.observed, { gap, final } = e;
  const { proposal, pending, approval, approved, change } = first;
  const { retired, refusal, control } = second;
  const scoped = id.endsWith('04'), revoked = id.endsWith('05');
  const operation = expectedApprovedBody(id), bytes = proposal.transport.serialized;
  const original = proposal.response.reviewId, route = '/reviews/' + original;
  const a = proposal.transport, b = refusal.exchange.transport, principal = a.principal;
  assert.match(original, uuid);
  assert.deepEqual(JSON.parse(bytes), operation, 'original operation');
  assert.deepEqual([a.method,a.path,a.phase,a.pid,proposal.response.status], ['POST','/tool/observed','A',pids.A,428]);
  const context = { session_id: id, channel_id: 'channel', scene_id: 'scene', task_id: null };
  const retained = { ...context, channel_id: 'retained' };
  assert.deepEqual(principal.allowed_contexts, scoped ? [context,retained] : [context]);
  assert.deepEqual([principal.principal_id,principal.agent_id,principal.role], ['principal-a','agent-a','agent']);
  assert.ok(principal.permissions.includes('runtime.evaluate'));
  assert.ok(b.principal && b.principal.principal_id === principal.principal_id && b.principal.agent_id === principal.agent_id, 'replacement identity');
  assert.deepEqual(b.principal, { ...principal, allowed_contexts: scoped ? [retained] : [context] }, 'authenticated scope');
  for (const tag of [a.tag,b.tag,approval.transport.tag]) assert.match(tag, /^[a-f0-9]{64}$/);
  assert.equal(new Set([a.tag,b.tag,approval.transport.tag]).size,3);
  assert.deepEqual([approval.transport.path,approval.transport.method,approval.transport.principal.role,
    approval.transport.principal.principal_id,approval.response.status], [route + '/approve','POST','reviewer','harness-reviewer',200]);
  const binding = requestBinding(operation, principal.principal_id);
  assert.deepEqual(pending.binding, binding, 'original review binding');
  assert.equal(pending.binding_hash,bindingHash(binding));
  assert.equal(pending.review_id,original);
  assert.equal(pending.request_id,proposal.response.requestId);
  assert.equal(pending.status,'pending');
  const decision = nativeEvent(approved.events,'authority.decision',pending.request_id);
  assert.equal(decision.outcome,'human_review');
  assert.match(pending.decision_id,uuid);
  assert.match(pending.evaluation_id,uuid);
  assert.equal(decision.decision_id,pending.decision_id);
  assert.equal(decision.evaluation_id,pending.evaluation_id);
  assert.equal(decision.principal_id,principal.principal_id);
  assert.deepEqual(decision.context,pending.context);
  assert.equal(pending.principal_id,principal.principal_id);
  assert.equal(pending.agent_id,principal.agent_id);
  const approvedEvent = nativeEvent(approved.events,'review.approved',pending.request_id);
  assert.equal(approvedEvent.review_id,original);
  assert.equal(approvedEvent.principal_id,principal.principal_id);
  assert.equal(approvedEvent.reviewer_principal_id,'harness-reviewer');
  assert.equal(proposal.response.body.authority_decision.evaluation_id,pending.evaluation_id);
  assert.deepEqual(approved.review,approval.response.body.review);
  assert.equal(approved.review.status,'approved');
  assert.equal(approved.review.execution.eligible,true);
  assert.equal(approved.review.reviewer_principal_id,'harness-reviewer');
  assert.equal(approved.review.original_envelope.level,'non_destructive');
  assert.ok(approved.review.original_envelope.tools.includes('fs.write'));
  assert.equal(approved.authority.context.level,1);
  assert.equal(approved.authority.context.revision,approved.review.original_envelope.revision);
  assert.deepEqual(approved.authority.revoked,[]);
  const key = canonical(pending.context);
  const persisted = gap.contexts[0];
  assert.equal(gap.contexts.length,1);
  assert.equal(persisted.context_key,key);
  if (scoped) {
    assert.equal(change,undefined);
    assert.deepEqual(persisted,{ context_key:key,...approved.authority.context },'unchanged governance');
  } else {
    assert.ok(change, 'authorized governance change');
    const { transport, response } = change.exchange;
    assert.deepEqual([transport.method,transport.path,transport.serialized,response.status],['POST',revoked ? '/revoke' : '/tool',bytes,revoked ? 200 : 403], 'change route');
    assert.deepEqual([transport.phase,transport.pid,transport.url],['A',pids.A,a.url]);
    if (revoked) {
      assert.deepEqual([transport.principal.principal_id,transport.principal.role],['harness-admin','authority_admin']);
      assert.ok(transport.principal.permissions.includes('authority.revoke_lease'));
      assert.ok(![a.tag,b.tag,approval.transport.tag].includes(transport.tag));
    } else {
      assert.deepEqual(transport.principal,principal);
      assert.equal(transport.tag,a.tag);
      assert.equal(change.detector.governance_signal.gate,2,'trusted gate-2 input');
      assert.deepEqual(response.body.governance_signal,change.detector.governance_signal);
      assert.equal(response.body.authority_decision.evaluation_id,change.detector.top_event.event_id);
    }
    const type = revoked ? 'capability.revoked' : 'authority.contracted';
    const event = nativeEvent(gap.events,type,response.requestId);
    assert.deepEqual(nativeEvent(change.audit,type,response.requestId),event);
    assert.equal(event.principal_id,transport.principal.principal_id);
    assert.equal(event.tool_id,'fs.write');
    assert.deepEqual(event.context,pending.context);
    assert.ok(event.sequence > nativeEvent(gap.events,'review.approved').sequence);
    const envelope = revoked ? response.body.capability_envelope : response.body.authority_decision.capability_envelope;
    assert.deepEqual(event.envelope,envelope);
    assert.equal(envelope.level,revoked ? 'non_destructive' : 'read_only');
    assert.ok(!envelope.tools.includes('fs.write'));
    assert.equal(persisted.level,revoked ? 1 : 2);
    assert.ok(persisted.revision > approved.authority.context.revision);
    assert.equal(persisted.revision,envelope.revision);
  }
  assert.deepEqual(gap.revocations,revoked ? [{ context_key:key,tool:'fs.write' }] : [], 'persisted revocation set');
  assert.deepEqual(gap.reviews,[approved.review]);
  assert.deepEqual(gap.events.filter((v:Native) => v.request_id === pending.request_id),approved.events);
  if (scoped) assert.deepEqual(gap.events,approved.events,'scope-only governance history');
  assert.deepEqual(gap,first.closing,'post-exit A snapshot');
  assert.deepEqual(second.opened,{ ...gap,observer:[readyA,readyB] },'reopened governance state');
  assert.deepEqual(final,second.closing,'post-exit B snapshot');
  for (const snap of [first.opened,first.closing,gap,second.opened,second.closing,final]) {
    noExecution(snap);
    assert.deepEqual(snap.calls,[],'adapter invocation');
    assert.deepEqual(snap.observer,[second.opened,second.closing,final].includes(snap) ? [readyA,readyB] : [readyA], 'durable observer');
  }
  for (const sample of [approved,retired.before,retired.after,refusal.before,refusal.after]) {
    noExecution(sample);
    assert.deepEqual(sample.observer,{ready:true,calls:[]},'observer readiness');
    assert.deepEqual(sample.entries,[],'adapter invocation');
    for (const field of ['review_id','binding','binding_hash','principal_id','agent_id','context','decision_id','evaluation_id','request_id','original_envelope','policy_fingerprint']) {
      assert.deepEqual(sample.review[field],pending[field], 'original review ' + field);
    }
    assert.equal(sample.review.consumed_at,null);
  }
  const seq = [approved.seq,retired.before.seq,retired.sent,retired.received,retired.after.seq,refusal.before.seq,refusal.sent,refusal.received,refusal.after.seq];
  assert.ok(seq.every((v,i) => Number.isSafeInteger(v) && (!i || v > seq[i-1])), 'fresh observations');
  for (const {exchange} of [retired,refusal]) {
    assert.deepEqual([exchange.transport.method,exchange.transport.path,exchange.transport.serialized],['POST',route+'/execute',bytes],'original execute binding');
    assert.deepEqual([exchange.transport.phase,exchange.transport.pid,exchange.transport.url],['B',pids.B,b.url]);
  }
  assert.deepEqual([retired.exchange.transport.tag,retired.exchange.transport.principal,retired.exchange.response.status],[a.tag,null,401]);
  assert.deepEqual(retired.calls,[]);
  assert.deepEqual(nativeEvent(retired.audit,'authentication.rejected',retired.exchange.response.requestId).reason_codes,['AUTHENTICATION_REQUIRED']);
  assert.deepEqual(retired.before.review,approved.review);
  const { context_key, ...contextState } = persisted;
  assert.deepEqual(retired.before.authority,{context:contextState,revoked:revoked ? ['fs.write'] : []});
  assert.deepEqual(refusal.after.authority,retired.before.authority);
  for (const attempt of [retired,refusal]) {
    assert.match(attempt.exchange.response.requestId,uuid);
    assert.deepEqual(attempt.audit,final.events.filter((v: Native) => v.request_id === attempt.exchange.response.requestId));
  }
  assert.notEqual(retired.exchange.response.requestId,refusal.exchange.response.requestId);
  assert.deepEqual(final.events.slice(gap.events.length).map((v:Native) => v.event_type),
    ['authentication.rejected',scoped ? 'authentication.rejected' : 'review.invalidated']);
  assert.deepEqual(refusal.after.events,final.events.filter((v: Native) => v.request_id === pending.request_id));
  assert.deepEqual(state(retired.before),state(retired.after));
  assert.deepEqual(state(retired.after),state(refusal.before));
  const {response} = refusal.exchange;
  assert.equal(response.status,403);
  for (const body of [retired.exchange.response.body,response.body]) {
    assert.ok(!Object.hasOwn(body,'execution_id') && !Object.hasOwn(body,'receipt'),'response execution evidence');
  }
  assert.equal(refusal.calls.length,scoped ? 0 : 1,'consumption boundary');
  if (scoped) {
    assert.deepEqual([control.transport.tag,control.transport.path,control.transport.method,control.response.status],[b.tag,'/turn','POST',200]);
    assert.deepEqual(control.transport.principal,b.principal);
    assert.deepEqual([control.transport.pid,control.transport.phase,control.transport.url],[pids.B,'B',b.url]);
    const positive = JSON.parse(control.transport.serialized);
    assert.deepEqual([positive.channel_id,positive.session_id,positive.speaker_id],['retained',id,principal.agent_id]);
    const rejection = nativeEvent(refusal.audit,'authentication.rejected',response.requestId);
    assert.deepEqual(rejection.reason_codes,['FORBIDDEN']);
    assert.equal(rejection.principal_id,principal.principal_id);
    assert.deepEqual(state(refusal.before),state(refusal.after));
    assert.ok(final.events.every((v:Native) => v.event_type !== 'review.invalidated'));
  } else {
    const reason = revoked ? 'CAPABILITY_REVOKED' : 'AUTHORITY_CONTRACTED';
    const [call] = refusal.calls;
    assert.deepEqual([call.id,call.operation,call.principal,call.phase,call.authorized,call.reason],[original,operation,b.principal,'B',false,reason],'native revalidation');
    assert.deepEqual(response.body,{review_id:original,execution_authorized:false,reason});
    assert.ok(refusal.audit.every((v:Native) => v.event_type !== 'authentication.rejected'),'revalidation ingress');
    assert.equal(refusal.after.review.status,'invalidated');
    assert.equal(refusal.after.review.execution.reason,reason);
    assert.equal(refusal.after.review.execution.eligible,false);
    const event = nativeEvent(final.events,'review.invalidated');
    assert.deepEqual(event.reason_codes,[reason]);
    assert.equal(event.review_id,original);
    assert.equal(event.request_id,pending.request_id);
    assert.equal(event.decision_id,pending.decision_id);
  }
  assert.deepEqual(final.reviews,[refusal.after.review]);
  assert.deepEqual(final.contexts,gap.contexts);
  assert.deepEqual(final.revocations,gap.revocations);
  assert.deepEqual(final.events.slice(0,gap.events.length),gap.events);
}
