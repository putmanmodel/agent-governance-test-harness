import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { runGatewayScenario, gatewayInvariant } from '../../src/adapters/kingpin-rc2/gateway-scenario.ts';
import type { GatewayEvidence } from '../../src/adapters/kingpin-rc2/gateway.ts';

test('real HTTP Gateway writes once, records UNKNOWN, reconciles, then denies revoked redispatch without a second execution', async () => {
  const result = await runGatewayScenario();
  assert.equal(result.passed, true, result.assertions[0].reason);
  const decisions = result.timeline.filter(r => r.category === 'governance');
  assert.deepEqual(decisions.map(r => r.data.result), ['ALLOW', 'DENY']);
  const first = decisions[0].data.evidence.kingpin_rc2_gateway as GatewayEvidence;
  const retry = decisions[1].data.evidence.kingpin_rc2_gateway as GatewayEvidence;
  assert.equal(first.gateway.status, 503); // ALLOW is distinct from the missing terminal receipt.
  assert.equal(first.receipt?.failure_code, 'RECEIPT_UNAVAILABLE');
  assert.equal(first.reconciled?.status, 'reconciled_succeeded');
  assert.equal(first.fileAfter.content, 'deterministic governance fixture\n');
  assert.equal(first.ledgerAfter.length, 1);
  assert.notEqual(first.nativeRequestId, retry.nativeRequestId);
  assert.notEqual(decisions[0].data.decisionId, decisions[1].data.decisionId);
  assert.equal(retry.harnessRequest.requestId, 'request-2');
  assert.equal(retry.harnessRequest.provenance.retryOf, 'request-1');
  assert.equal(retry.controls[1].validation.reason, 'capability_revoked');
  assert.equal(retry.gateway.status, 403);
  assert.deepEqual(first.ledgerAfter, retry.ledgerAfter);
  assert.deepEqual(first.fileAfter, retry.fileAfter);
  assert.deepEqual(result.timeline.filter(r => r.category === 'execution').map(r => r.data.status),
    ['STARTED', 'UNKNOWN', 'SUCCEEDED', 'NOT_STARTED']);
  assert.ok(first.audit.some(e => e.event_type === 'tool.execution.started' && e.execution_id === first.receipt?.execution_id));
  assert.ok(!existsSync(first.sandbox), 'temporary effect and database are cleaned up');
  const tampered = structuredClone(result.timeline);
  const second = tampered.find(r => r.category === 'governance' && r.data.requestId === 'request-2');
  assert.ok(second?.category === 'governance');
  (second.data.evidence.kingpin_rc2_gateway as GatewayEvidence).ledgerAfter.push({ execution_id: 'forbidden-second-effect' });
  assert.equal(gatewayInvariant(tampered).passed, false, 'DENY alone must not prove no second execution');
});
