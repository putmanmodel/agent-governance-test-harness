import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KingpinRc2Adapter, mapRequest, normalizeDecision } from '../src/adapters/kingpin-rc2/adapter.ts';
import type { AuditContext, NativeDecision, Rc2Boundary } from '../src/adapters/kingpin-rc2/contracts.ts';
import { retryBinding } from '../src/adapters/kingpin-rc2/load.ts';
import { retryAfterRevocation } from '../scenarios/retry-after-revocation.ts';
import { runScenario } from '../src/core/runner.ts';

const proposal = retryAfterRevocation.events[1];
if (!('requestId' in proposal)) throw new Error('Missing proposal');
const original = proposal.payload.request;
const native = (outcome: string): NativeDecision => ({ schema_version: '1.0', issuer: 'kingpin',
  outcome, reason: `native-${outcome}`, evaluation_id: 'evaluation-1', reason_codes: ['NATIVE_CODE'],
  capability_envelope: { revision: 7 }, effective_gate: 2 });

test('RC2 request translation binds action/target and agent without promoting provenance', () => {
  const input = mapRequest({ ...original, provenance: { ...original.provenance, retryOf: 'old' } }, retryBinding, 'opaque-token');
  assert.deepEqual(input, { tool: 'fs.delete', args: { path: '/project' }, speaker_id: 'agent-a',
    channel_id: 'channel', scene_id: 'scene', session_id: 'retry-after-revocation', lease_token: 'opaque-token' });
  assert.throws(() => mapRequest({ ...original, target: 'unbound' }, retryBinding));
});

test('RC2 normalizes all five native outcomes without accepting unsupported decisions', () => {
  for (const [outcome, expected] of Object.entries({ allow: 'ALLOW', deny: 'DENY', quarantine: 'DENY',
    constrain: 'INDETERMINATE', human_review: 'INDETERMINATE' })) {
    assert.equal(normalizeDecision(native(outcome)), expected);
  }
  assert.throws(() => normalizeDecision(native('future-outcome')));
  assert.throws(() => normalizeDecision({ ...native('allow'), issuer: 'other' }));
});

function fixture(acknowledged = true) {
  const calls: string[] = [];
  const audits = new Map<string, Record<string, unknown>[]>();
  let revoked = false;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const runtime: Rc2Boundary = {
    // Canned boundary responses, not a policy implementation.
    decide(_signal, _input, evaluationId, audit: AuditContext) {
      calls.push(audit.request_id);
      const decision = { ...native(audit.request_id === 'request-2' ? 'deny' : 'allow'), evaluation_id: evaluationId };
      audits.set(audit.request_id, [{ event_type: 'authority.decision', request_id: audit.request_id,
        decision_id: audit.decision_id, principal_id: audit.principal_id,
        outcome: decision.outcome, evaluation_id: evaluationId }]);
      return decision;
    },
    issue: () => ({ lease_token: 'secret-token', lease_id: 'native-nonce' }),
    async revokeLeaseNonce(nonce) {
      calls.push('revocation-pending');
      await barrier;
      revoked = acknowledged;
      calls.push('revocation-acknowledged');
      return { revoked: acknowledged, lease_nonce: nonce };
    },
    validateLease: () => ({ valid: !revoked, reason: revoked ? 'nonce_revoked' : 'ok' }),
    getEventsForRequest: id => audits.get(id) ?? [],
  };
  const turns = ['setup', 'first', 'retry'].map(id => ({ governance_signal: {}, top_event: { event_id: id } }));
  return { calls, release, adapter: new KingpinRc2Adapter(runtime, turns, retryBinding, original) };
}

test('adapter awaits acknowledged revocation, preserves native evidence and fresh retry provenance', async () => {
  const f = fixture();
  const running = runScenario(retryAfterRevocation, f.adapter);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.at(-1), 'revocation-pending');
  assert.equal(f.calls.includes('request-2'), false);
  f.release();
  const result = await running;
  assert.equal(result.passed, true);
  assert.deepEqual(f.calls, ['rc2-setup', 'request-1', 'revocation-pending', 'revocation-acknowledged', 'request-2']);
  const retry = result.timeline.find(r => r.category === 'governance' && r.data.requestId === 'request-2');
  assert.ok(retry?.category === 'governance');
  const evidence = retry.data.evidence.kingpin_rc2 as Record<string, any>;
  assert.deepEqual(evidence.native, { ...native('deny'), evaluation_id: 'retry' });
  assert.equal(evidence.harnessRequest.provenance.retryOf, 'request-1');
  assert.equal(evidence.harnessRequest.principal, 'principal-a');
  assert.equal(evidence.audit[0].principal_id, 'principal-a');
  assert.equal(evidence.controls[1].validation.reason, 'nonce_revoked');
  assert.equal(evidence.execution, 'harness-simulation');
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('unacknowledged revocation aborts instead of submitting a retry', async () => {
  const f = fixture(false);
  f.release();
  await assert.rejects(runScenario(retryAfterRevocation, f.adapter), /not observably acknowledged/);
  assert.equal(f.calls.includes('request-2'), false);
});
