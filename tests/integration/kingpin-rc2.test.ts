import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRc2Adapter } from '../../src/adapters/kingpin-rc2/load.ts';
import { retryAfterRevocation } from '../../scenarios/retry-after-revocation.ts';
import { runScenario } from '../../src/core/runner.ts';

test('real CDE/Kingpin RC2 denies the fresh retry after acknowledged nonce revocation', async () => {
  const proposal = retryAfterRevocation.events[1];
  assert.ok('requestId' in proposal);
  const result = await runScenario(retryAfterRevocation, await loadRc2Adapter(proposal.payload.request));
  assert.equal(result.passed, true);
  const decisions = result.timeline.filter(r => r.category === 'governance');
  assert.deepEqual(decisions.map(r => r.data.result), ['ALLOW', 'DENY']);
  assert.deepEqual(decisions.map(r => r.data.requestId), ['request-1', 'request-2']);
  const first = decisions[0].data.evidence.kingpin_rc2 as Record<string, any>;
  const retry = decisions[1].data.evidence.kingpin_rc2 as Record<string, any>;
  assert.equal(first.native.reason, 'gate_2_lease_valid');
  assert.equal(retry.native.reason, 'gate_2_requires_valid_lease');
  assert.equal(retry.lease_validation.reason, 'nonce_revoked');
  assert.equal(retry.controls[1].acknowledgement.lease_nonce, retry.lease_id);
  assert.ok(retry.controls[1].audit.some((event: Record<string, unknown>) => event.event_type === 'lease.revoked'));
  assert.ok(retry.audit.some((event: Record<string, unknown>) => event.event_type === 'authority.decision' && event.lease_check === 'nonce_revoked'));
  assert.notEqual(first.native.evaluation_id, retry.native.evaluation_id);
  assert.equal(retry.execution, 'harness-simulation');
});
