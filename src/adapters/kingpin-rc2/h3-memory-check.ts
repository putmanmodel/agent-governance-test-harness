import assert from 'node:assert/strict';
import type { sqliteRotationCases, memoryRotationCases } from '../../../scenarios/registrations.ts';
import { bindingHash, expectedApprovedBody, requestBinding } from './approved-restart-binding.ts';

export type RotationCase = typeof memoryRotationCases[number];
type Native = Record<string, any>;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function state({ seq, ...value }: Native) { return value; }

export function verifyRotation(id: RotationCase, e: Native) {
  assert.equal(e.cutover.retiredListening, false);
  assert.equal(e.cutover.store, 'MemoryStateStore');
  assert.ok(Number.isSafeInteger(e.cutover.pid) && e.cutover.pid > 0);
  verifyRotationObservations(id, e, { A: e.cutover.pid, B: e.cutover.pid });
}

export function verifyRotationObservations(id: RotationCase | typeof sqliteRotationCases[number], e: Native, pids: { A: number; B: number }) {
  const { proposal, pending, approval, approved, retired, success, replay } = e;
  const original = proposal.response.reviewId, route = '/reviews/' + original;
  const operation = expectedApprovedBody(id), bytes = proposal.transport.serialized;
  const a = proposal.transport, b = replay.exchange.transport;
  assert.match(original, uuid);
  assert.equal(proposal.response.status, 428);
  assert.equal(a.path, '/tool/observed');
  assert.deepEqual(JSON.parse(bytes), operation);
  assert.equal(a.principal.principal_id, 'principal-a');
  assert.equal(a.principal.agent_id, 'agent-a');
  assert.equal(a.principal.role, 'agent');
  assert.ok(a.principal.permissions.includes('runtime.evaluate'));
  assert.deepEqual(a.principal.allowed_contexts, [{ session_id: id, channel_id: 'channel', scene_id: 'scene', task_id: null }]);
  assert.deepEqual(b.principal, a.principal, 'replacement identity');
  assert.match(a.tag, /^[0-9a-f]{64}$/);
  assert.match(b.tag, /^[0-9a-f]{64}$/);
  assert.notEqual(a.tag, b.tag);
  assert.equal(a.phase, 'A');
  assert.equal(b.phase, 'B');
  assert.equal(pending.request_id, proposal.response.requestId);
  const binding = requestBinding(operation, a.principal.principal_id);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.review_id, original);
  assert.deepEqual(pending.binding, binding);
  assert.equal(pending.binding_hash, bindingHash(binding));
  const decision = proposal.response.body.authority_decision;
  assert.equal(decision.outcome, 'human_review');
  const decisions = approved.events.filter((v: Native) => v.event_type === 'authority.decision');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision_id, pending.decision_id);
  assert.equal(decisions[0].request_id, pending.request_id);
  assert.match(pending.decision_id, uuid);
  assert.match(pending.evaluation_id, uuid);
  assert.equal(pending.evaluation_id, decision.evaluation_id);
  assert.equal(approval.transport.path, route + '/approve');
  assert.equal(approval.transport.principal.role, 'reviewer');
  assert.equal(approval.transport.principal.principal_id, 'harness-reviewer');
  assert.ok(![a.tag,b.tag].includes(approval.transport.tag));
  assert.equal(approval.response.status, 200);
  assert.deepEqual(approval.response.body.review, approved.review);
  assert.equal(approved.review.reviewer_principal_id, 'harness-reviewer');
  assert.equal(approved.review.status, 'approved');
  assert.equal(approved.review.consumed_at, null);
  assert.equal(approved.review.execution.eligible, true);
  assert.ok(approved.review.original_envelope.tools.includes('fs.write'));
  assert.equal(approved.authority.context.revision, approved.review.original_envelope.revision);
  assert.deepEqual(approved.authority.revoked, []);
  for (const field of ['review_id','decision_id','evaluation_id','principal_id','agent_id','context',
    'request_id','original_envelope','policy_fingerprint','binding_hash','binding']) {
    assert.deepEqual(approved.review[field], pending[field]);
  }
  assert.deepEqual(approved.ledger, []);
  assert.deepEqual(approved.entries, []);
  assert.deepEqual(approved.observer, { ready: true, calls: [] });
  assert.deepEqual(approved.directory, ['seed.txt']);
  assert.deepEqual(approved.file, { source: 'harness', exists: false });
  const successInB = id.endsWith('CR-01');
  assert.equal(replay.exchange.response.status, 409, 'consumed conflict');
  assert.equal(replay.calls.length, 1, 'consumption boundary');
  assert.equal(replay.calls[0].id, original, 'original boundary UUID');
  const ordered = successInB ? [retired,success,replay] : [success,retired,replay];
  let previous = approved;
  for (const attempt of ordered) {
    const { before, sent, received, after, exchange } = attempt;
    assert.ok([previous.seq,before.seq,sent,received,after.seq].every(Number.isSafeInteger) &&
      previous.seq < before.seq && before.seq < sent && sent < received && received < after.seq, 'fresh samples');
    assert.deepEqual(state(before), state(previous), 'continuous observations');
    assert.equal(exchange.transport.path, route + '/execute', 'original execute UUID');
    assert.equal(exchange.transport.method, 'POST');
    assert.equal(exchange.transport.serialized, bytes);
    assert.equal(exchange.transport.pid, attempt === success && !successInB ? pids.A : pids.B);
    assert.equal(a.pid, pids.A);
    const ingress = attempt === success && !successInB ? a : b;
    assert.equal(exchange.transport.phase, ingress.phase);
    assert.equal(exchange.transport.url, ingress.url);
    assert.equal(exchange.transport.tag, attempt === retired ? a.tag : ingress.tag);
    assert.deepEqual(exchange.transport.principal, attempt === retired ? null : a.principal);
    assert.deepEqual(after.authority, approved.authority, 'applicable authority');
    assert.equal(after.review.review_id, original);
    assert.deepEqual(after.review.binding, binding);
    assert.equal(after.review.policy_fingerprint, pending.policy_fingerprint);
    previous = after;
  }
  assert.equal(retired.exchange.response.status, 401);
  assert.deepEqual(retired.calls, []);
  assert.ok(retired.audit.some((v: Native) => v.event_type === 'authentication.rejected' &&
    v.request_id === retired.exchange.response.requestId && v.principal_id === null && v.reason_codes.includes('AUTHENTICATION_REQUIRED')));
  assert.deepEqual(state(retired.before), state(retired.after));
  for (const attempt of [success,replay]) {
    assert.equal(attempt.calls.length, 1, 'consumption boundary');
    const [call] = attempt.calls;
    assert.equal(call.id, original);
    assert.equal(call.phase, attempt.exchange.transport.phase);
    assert.deepEqual(call.operation, operation);
    assert.deepEqual(call.principal, a.principal);
  }
  assert.equal(success.calls[0].authorized, true);
  assert.equal(success.exchange.response.status, 200);
  const done = success.after, response = success.exchange.response.body;
  assert.equal(response.review_id, original);
  assert.equal(response.execution_authorized, true);
  assert.equal(done.review.status, 'consumed');
  assert.ok(Number.isFinite(Date.parse(done.review.consumed_at)));
  assert.equal(done.entries.length, 1, 'adapter cardinality');
  const [entry] = done.entries;
  assert.equal(entry.sequence, 1);
  assert.ok(Number.isFinite(Date.parse(entry.timestamp)));
  assert.equal(entry.tag, success.exchange.transport.tag);
  assert.equal(entry.phase, success.exchange.transport.phase);
  assert.equal(entry.reviewId, original);
  assert.deepEqual(entry.operation, operation);
  assert.deepEqual(done.observer, { ready: true, calls: [operation] }, 'observer read');
  assert.deepEqual(done.directory, ['effect.txt','seed.txt']);
  assert.equal(done.file.source, 'harness');
  assert.equal(done.file.exists, true);
  assert.equal(done.file.content, operation.args.content);
  assert.equal(done.ledger.length, 1, 'receipt cardinality');
  const [receipt] = done.ledger;
  assert.match(receipt.execution_id, uuid);
  assert.equal(receipt.execution_id, response.execution_id);
  assert.equal(receipt.review_id, original);
  assert.equal(receipt.decision_id, pending.decision_id);
  assert.equal(receipt.principal_id, a.principal.principal_id);
  assert.equal(receipt.request_hash, pending.binding_hash);
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.request_id, pending.request_id);
  assert.equal(receipt.evaluation_id, pending.evaluation_id);
  assert.equal(receipt.agent_id, a.principal.agent_id);
  assert.equal(receipt.tool_id, operation.tool);
  assert.deepEqual(done.events.filter((v: Native) => v.event_type.startsWith('review.')).map((v: Native) => v.event_type),
    ['review.requested','review.approved','review.execution_authorized','review.execution_consumed']);
  assert.equal(replay.audit.some((v: Native) => v.event_type === 'authentication.rejected' || v.event_type.startsWith('tool.execution.')), false);
  const lifecycle = done.events.filter((v: Native) => v.event_type.startsWith('tool.execution.'));
  assert.deepEqual(lifecycle.map((v: Native) => v.event_type), ['tool.execution.started','tool.execution.succeeded'], 'execution lifecycle');
  for (const event of lifecycle) {
    assert.equal(event.execution_id, receipt.execution_id);
    assert.equal(event.review_id, original);
  }
  assert.deepEqual(replay.exchange.response.body, { error: 'Review execution refused' });
  assert.equal(replay.calls[0].error, 'Review not approved or already consumed');
  assert.deepEqual(state(replay.before), state(replay.after), 'replay delta');
}
