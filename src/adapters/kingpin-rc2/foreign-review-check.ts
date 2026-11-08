import assert from 'node:assert/strict';
import { foreignReviewRegistration } from '../../../scenarios/registrations.ts';
import { bindingHash, requestBinding } from './approved-restart-binding.ts';

export const scenarioId = foreignReviewRegistration.id;
const context = { session_id: scenarioId, channel_id: 'channel', scene_id: 'scene', task_id: null };
export const operation = { ...context, speaker_id: 'agent-a', tool: 'fs.write',
  args: { path: 'effect.txt', content: 'deterministic governance fixture\n' },
  plan_id: 'foreign-principal-bound-operation', user_request: '.', dry_run: true, diff: 'create effect.txt' };
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;

type Native = Record<string, any>;

const nonemptyText = (value: unknown) => typeof value === 'string' && value.length > 0;

// Mirror validateReview and validContext for the original capability envelope.
// The recorded verifier runs independently of a Kingpin checkout.
function checkOriginalEnvelope(envelope: Native) {
  const reason = 'invalid original review envelope for ' + operation.tool;
  assert.ok(envelope && typeof envelope === 'object', reason);
  assert.deepEqual(Object.keys(envelope).sort(), ['clean_evaluations', 'level', 'restoration_step_after',
    'revision', 'revoked_tools', 'tools'], reason);
  assert.ok(['full', 'non_destructive', 'read_only', 'quarantined'].includes(envelope.level), reason);
  assert.ok(Array.isArray(envelope.tools) && envelope.tools.every(nonemptyText) && envelope.tools.includes(operation.tool), reason);
  assert.ok(Array.isArray(envelope.revoked_tools) && envelope.revoked_tools.every(nonemptyText), reason);
  assert.equal(envelope.restoration_step_after, 2, reason);
  assert.ok([0, 1].includes(envelope.clean_evaluations) && (envelope.level !== 'full' || envelope.clean_evaluations === 0), reason);
  assert.ok(Number.isSafeInteger(envelope.revision) && envelope.revision >= 0, reason);
}

function checkExecutionFields(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    assert.ok(!['execution_id', 'receipt', 'execution_receipt', 'execution_status'].includes(key), 'unexpected execution ID or receipt');
    if (['execution_authorized', 'authorization_consumed'].includes(key)) assert.equal(field, false, 'unexpected execution authorization');
    checkExecutionFields(field);
  }
}

function checkCollectionOrder(e: Native) {
  const reads = (sample: Native) => [sample.order.ledgerRead, sample.order.observerRead, sample.order.directoryRead];
  const sequence = [...reads(e.initial), ...reads(e.approved), e.exchangeOrder.dispatch, e.exchangeOrder.received, ...reads(e.final)];
  assert.ok(sequence.every((n, i) => Number.isSafeInteger(n) && n > (sequence[i - 1] ?? 0)), 'HTTP and observation collection order');
}

function checkAuditOrder(events: Native[], rejection: Native) {
  const all = [...events, rejection];
  const ids = new Set<string>(), sequences = new Set<number>();
  for (const r of all) {
    assert.match(r.event_id, uuid, 'native event identity');
    assert.ok(!ids.has(r.event_id), 'duplicate native event identity');
    ids.add(r.event_id);
    assert.ok(Number.isSafeInteger(r.sequence) && r.sequence > 0 && !sequences.has(r.sequence), 'invalid or duplicate native sequence');
    sequences.add(r.sequence);
  }
  assert.ok(all.every((r, i) => !i || r.sequence === all[i - 1].sequence + 1), 'native causal sequence');
  // This isolated fixture has no intervening requests in the audited window.
  assert.deepEqual(events.map(r => r.event_type), ['cde.signal.created', 'authority.requested', 'authority.contracted',
    'authority.decision', 'review.requested', 'tool.enforcement.review', 'review.approved'], 'native causal event order');
}

// Persisted Gateway evidence is untrusted. Every positive and negative assertion
// is evaluated against the fixed fixture or a correlated native record.
export function verifyForeignReview(e: Record<string, any>) {
  const { proposal, approval, attempt, pending, before, after } = e;
  const a = proposal.transport.principal, b = attempt.transport.principal, reviewer = approval.transport.principal;
  assert.notEqual(a.principal_id, b.principal_id, 'distinct resolver principals');
  for (const [principal, suffix, session] of [[a, 'a', scenarioId], [b, 'b', scenarioId + '-b']] as const) {
    assert.deepEqual([principal.role, principal.principal_id, principal.agent_id, principal.allowed_contexts],
      ['agent', 'principal-' + suffix, 'agent-' + suffix, [{ ...context, session_id: session }]], 'resolver mapping');
  }
  assert.deepEqual([reviewer.role, reviewer.principal_id, reviewer.allowed_contexts],
    ['reviewer', 'harness-reviewer', [context]], 'reviewer resolver mapping');
  for (const principal of [a, b]) {
    assert.deepEqual(principal.permissions, ['runtime.evaluate', 'runtime.use_lease'], 'trusted runtime permissions');
  }
  assert.ok(Array.isArray(reviewer.permissions) && reviewer.permissions.includes('review.resolve')
    && reviewer.permissions.includes('review.access'), 'trusted reviewer permissions');
  assert.deepEqual(JSON.parse(proposal.transport.serialized), operation, 'fixed operation');
  assert.equal(attempt.transport.serialized, proposal.transport.serialized, 'unchanged serialized body');
  const id = proposal.response.reviewId;
  assert.match(id, uuid, 'original review ID');
  assert.deepEqual([proposal.transport.path, approval.transport.path, attempt.transport.path],
    ['/tool/observed', '/reviews/' + id + '/approve', '/reviews/' + id + '/execute'], 'original review URL');
  for (const call of [proposal, approval, attempt]) {
    assert.equal(call.transport.method, 'POST');
    assert.match(call.response.requestId, uuid, 'X-Request-ID');
  }
  assert.equal(new Set([proposal, approval, attempt].map(call => call.response.requestId)).size, 3, 'fresh request IDs');
  const d = proposal.response.body.authority_decision;
  assert.deepEqual([proposal.response.status, proposal.response.body.allow, d.issuer, d.outcome, d.cde_gate],
    [428, false, 'kingpin', 'human_review', 1], 'native hold');
  checkExecutionFields(e);
  const binding = requestBinding(operation, a.principal_id);
  assert.deepEqual(pending.binding, binding, 'fixed native binding');
  assert.equal(pending.binding_hash, bindingHash(binding), 'fixed binding hash');
  assert.match(pending.decision_id, uuid);
  assert.match(pending.evaluation_id, uuid);
  assert.deepEqual([pending.review_id, pending.status, pending.request_id, pending.evaluation_id, pending.principal_id,
    pending.agent_id, pending.original_outcome, pending.signal_reason_codes],
    [id, 'pending', proposal.response.requestId, d.evaluation_id, a.principal_id, a.agent_id, 'human_review', ['LOW_CONFIDENCE']], 'original review identity and trigger');
  const expectedContext = { session_id: a.allowed_contexts[0].session_id, speaker_id: a.agent_id,
    channel_id: operation.channel_id, scope_key: 'scene:' + operation.scene_id };
  assert.deepEqual(pending.context, expectedContext, 'derived review context');
  assert.deepEqual(d.context, expectedContext, 'native decision context');
  const mutable = ['status', 'resolved_at', 'reviewer_principal_id', 'resolution', 'resolution_reason', 'consumed_at', 'execution'];
  const reviewFields = [...mutable, 'schema_version', 'review_id', 'request_id', 'evaluation_id', 'decision_id', 'principal_id',
    'agent_id', 'context', 'tool_id', 'binding', 'binding_hash', 'policy_version', 'policy_fingerprint', 'original_outcome',
    'original_envelope', 'original_reason_codes', 'cde_gate', 'signal_reason_codes', 'created_at'].sort();
  for (const review of [pending, approval.response.body.review, before, after]) {
    assert.deepEqual(Object.keys(review).sort(), reviewFields, 'native review fields');
    checkOriginalEnvelope(review.original_envelope);
    const reasons = review.original_reason_codes;
    assert.ok(Array.isArray(reasons) && reasons.every(nonemptyText) && reasons.includes('LOW_CONFIDENCE_REQUIRES_HUMAN_REVIEW'),
      'invalid original HUMAN REVIEW trigger');
  }
  for (const key of mutable.slice(1)) assert.equal(pending[key], null, 'pending review ' + key);
  assert.deepEqual([pending.schema_version, pending.tool_id, pending.policy_version, pending.cde_gate,
    pending.original_envelope, pending.original_reason_codes], ['1.0', operation.tool, d.policy_version, 1,
    d.capability_envelope, d.reason_codes], 'native review decision facts');
  assert.match(pending.policy_fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(Number.isFinite(Date.parse(pending.created_at)), 'review creation time');
  assert.deepEqual([approval.response.status, approval.response.body.ready_for_consumption, approval.response.body.execution_authorized],
    [200, true, false], 'approval readiness');
  assert.deepEqual([before.status, before.reviewer_principal_id, before.resolution, before.execution.eligible, before.consumed_at],
    ['approved', reviewer.principal_id, 'approve', true, null], 'historical approval');
  assert.equal(before.resolution_reason, 'REVIEWER_APPROVED');
  assert.deepEqual(before, approval.response.body.review, 'persisted approval');
  assert.equal(before.original_outcome, 'human_review', 'immutable original outcome');
  assert.ok(Number.isFinite(Date.parse(before.resolved_at)) && Date.parse(before.resolved_at) >= Date.parse(pending.created_at),
    'approval resolution time');
  assert.deepEqual(before.execution, { eligible: true, reason: 'ALLOWED', checked_at: before.resolved_at }, 'approval eligibility');
  const immutable = (r: Native) => Object.fromEntries(Object.entries(r).filter(([key]) => !mutable.includes(key)));
  assert.deepEqual(immutable(before), immutable(pending), 'immutable native review facts');
  assert.deepEqual([attempt.response.status, attempt.response.body, attempt.response.reviewId],
    [403, { error: 'Forbidden' }, null], 'native ingress refusal');
  assert.ok(Array.isArray(e.attemptAudit), 'attempt audit array');
  assert.equal(e.attemptAudit.length, 1, 'exactly one attempt event');
  const rejection = e.attemptAudit[0];
  assert.equal(rejection.event_type, 'authentication.rejected', 'native rejection event');
  assert.equal(rejection.request_id, attempt.response.requestId, 'rejection request correlation');
  assert.equal(rejection.principal_id, b.principal_id, 'trusted rejection principal');
  assert.equal(rejection.outcome, 'rejected');
  assert.deepEqual(rejection.reason_codes, ['FORBIDDEN'], 'forbidden reason');
  assert.equal(rejection.decision_id, null);
  assert.equal(rejection.evaluation_id, null);
  assert.equal(rejection.execution_id, undefined);
  assert.deepEqual(after, before, 'unchanged approved review');
  assert.ok(Array.isArray(e.originalAudit) && Array.isArray(e.originalAuditAfter), 'original audit arrays');
  assert.deepEqual(e.originalAuditAfter, e.originalAudit, 'unchanged original history');
  for (const type of ['authority.decision', 'review.requested', 'review.approved']) {
    const matches: Record<string, any>[] = e.originalAudit.filter((r: any) => r.event_type === type);
    assert.equal(matches.length, 1, 'unique ' + type);
    const r = matches[0];
    assert.deepEqual([r.principal_id, r.decision_id, r.evaluation_id], [a.principal_id, pending.decision_id, d.evaluation_id]);
    if (type.startsWith('review.')) assert.equal(r.review_id, id);
    if (type === 'review.approved') {
      assert.equal(r.reviewer_principal_id, reviewer.principal_id);
      assert.equal(r.outcome, 'approved');
      assert.ok(r.sequence < rejection.sequence, 'approval precedes refusal');
    }
    else assert.equal(r.outcome, 'human_review');
  }
  for (const r of e.originalAudit) {
    assert.deepEqual([r.request_id, r.principal_id, r.evaluation_id, r.context],
      [proposal.response.requestId, a.principal_id, d.evaluation_id, expectedContext], 'native event correlation');
    if (r.event_type === 'tool.enforcement.review') {
      assert.deepEqual([r.tool_id, r.decision_id], [operation.tool, pending.decision_id], 'enforcement hold tool and decision');
    }
    const preDecision = ['cde.signal.created', 'authority.requested'].includes(r.event_type);
    const approved = r.event_type === 'review.approved';
    assert.equal(r.outcome, preDecision ? null : approved ? 'approved' : 'human_review', 'native event outcome');
    assert.deepEqual(r.reason_codes, preDecision ? [] : approved ? ['REVIEWER_APPROVED'] : d.reason_codes, 'native event reasons');
    assert.ok(['authority.requested','authority.contracted','authority.decision','recovery.stage_changed','cde.signal.created',
      'tool.enforcement.review','review.requested','review.approved'].includes(r.event_type), 'unexpected lifecycle');
  }
  checkAuditOrder(e.originalAudit, rejection);
  checkCollectionOrder(e);
  for (const sample of [e.initial, e.approved, e.final]) {
    assert.ok(Array.isArray(sample.ledger), 'full ledger array');
    assert.equal(sample.ledger.length, 0, 'empty full ledger');
    assert.equal(sample.observer.ready, true, 'execute observer readiness');
    assert.deepEqual(sample.observer.calls, [], 'zero adapter calls');
    assert.deepEqual(sample.directory, ['seed.txt'], 'bounded sandbox contents');
  }
}
