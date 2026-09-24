import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApplicable, summarizeApplicability } from '../src/core/applicability.ts';
import { subprocessReferenceRuntime } from '../src/adapters/subprocess/capabilities.ts';
import { rc2GovernanceRuntime, rc2GatewayRuntime } from '../src/adapters/kingpin-rc2/capabilities.ts';
import { retryRegistration, gatewayRetryRegistration, reviewRegistration, currentScenarioRegistrations } from '../scenarios/registrations.ts';
import { runSubprocessSuite } from '../src/adapters/subprocess/suite.ts';

test('supported scenario executes and reports PASS', async () => {
  let executed = false;
  const result = await runApplicable(subprocessReferenceRuntime, retryRegistration, async () => { executed = true; return { passed: true }; });
  assert.equal(executed, true); assert.equal(result.status, 'PASS');
});

test('missing prerequisites are reported exactly before any execution and never count as PASS', async () => {
  const result = await runApplicable(subprocessReferenceRuntime, reviewRegistration, async () => { assert.fail('Must not execute'); });
  assert.equal(result.status, 'UNSUPPORTED');
  assert.equal(result.runtimeId, 'subprocess-reference'); assert.equal(result.scenarioId, 'human-approval-replay');
  assert.deepEqual(result.missingCapabilities, ['human-review', 'execution-accounting']);
  assert.deepEqual(summarizeApplicability([result]), { passed: 0, failed: 0, unsupported: 1 });
});

test('supported exceptions and assertion failures remain FAIL', async () => {
  for (const execute of [async () => { throw new Error('Malformed protocol / missing evidence'); }, async () => ({ passed: false })]) {
    const result = await runApplicable(subprocessReferenceRuntime, retryRegistration, execute);
    assert.equal(result.status, 'FAIL'); assert.deepEqual(result.missingCapabilities, []);
  }
});

test('explicit caller requirements cannot be opted out by omitting a declaration', async () => {
  const result = await runApplicable(subprocessReferenceRuntime, reviewRegistration, async () => { assert.fail('Must not execute'); }, ['human-review']);
  assert.equal(result.status, 'FAIL'); assert.deepEqual(result.missingCapabilities, ['human-review']);
  assert.match(result.reason, /explicit caller/);
});

test('subprocess suite runs only retry and reports five unsupported scenarios', async () => {
  const results = await runSubprocessSuite();
  assert.deepEqual(results.map(r => r.status), ['PASS', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED']);
  assert.deepEqual(summarizeApplicability(results), { passed: 1, failed: 0, unsupported: 5 });
});

test('RC2 declarations cover actual governance and Gateway paths', () => {
  assert.deepEqual(rc2GovernanceRuntime.capabilities, ['revocation']);
  assert.ok(retryRegistration.requires.every(c => rc2GovernanceRuntime.capabilities.includes(c)));
  for (const scenario of [...currentScenarioRegistrations, gatewayRetryRegistration]) {
    assert.ok(scenario.requires.every(c => rc2GatewayRuntime.capabilities.includes(c)), scenario.id);
  }
  assert.deepEqual(gatewayRetryRegistration.requires, ['revocation', 'execution-accounting', 'reconciliation']);
});
