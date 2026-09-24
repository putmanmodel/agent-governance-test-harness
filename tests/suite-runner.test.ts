import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeProfile } from '../src/runtime-registry.ts';
import { getSuite, runSuite, suiteExitCode } from '../src/suite-runner.ts';
import { runCli } from '../src/harness-cli.ts';

test('static registry selects known runtime profiles and rejects unknown names', () => {
  for (const id of ['subprocess-reference', 'kingpin-rc2-governance', 'kingpin-rc2-gateway']) assert.equal(getRuntimeProfile(id).runtime.id, id);
  assert.throws(() => getRuntimeProfile('toString'), /Unknown runtime/);
  assert.equal(getSuite('current').scenarios.length, 6);
  assert.throws(() => getSuite('other'), /Unknown suite/);
  assert.ok(getRuntimeProfile('kingpin-rc2-gateway').requirements?.['retry-after-revocation'].requires.includes('reconciliation'));
});

test('suite skips unsupported drivers, preserves missing requirements and exits zero', async () => {
  let called = 0;
  const report = await runSuite({ runtime: { id: 'fixture', capabilities: ['revocation'] }, drivers: {
    'retry-after-revocation': async () => { called++; return { passed: true }; },
    'human-approval-replay': async () => { assert.fail('Unsupported driver executed'); },
  } }, getSuite('current'));
  assert.equal(called, 1); assert.equal(suiteExitCode(report), 0);
  assert.deepEqual(report.summary, { passed: 1, failed: 0, unsupported: 5 });
  assert.deepEqual(report.results[1].missingCapabilities, ['human-review', 'execution-accounting']);
});

for (const failure of ['assertion', 'setup', 'missing-driver']) {
  test(`${failure} failure produces nonzero suite exit`, async () => {
    const report = await runSuite({ runtime: { id: 'fixture', capabilities: ['revocation'] }, drivers: failure === 'missing-driver' ? {} : {
      'retry-after-revocation': async () => { if (failure === 'setup') throw new Error('Setup failed'); return { passed: false }; },
    } }, getSuite('current'));
    assert.equal(report.results[0].status, 'FAIL'); assert.equal(suiteExitCode(report), 1);
  });
}

test('CLI JSON mode runs subprocess suite with correct statuses and summary', async () => {
  const lines: string[] = [];
  const code = await runCli(['run', '--runtime', 'subprocess-reference', '--suite', 'current', '--json'], s => lines.push(s), s => assert.fail(s));
  assert.equal(code, 0); assert.equal(lines.length, 1);
  const report = JSON.parse(lines[0]);
  assert.equal(report.runtimeId, 'subprocess-reference'); assert.equal(report.suiteId, 'current');
  assert.deepEqual(report.summary, { passed: 1, failed: 0, unsupported: 5 });
  assert.deepEqual(report.results.map((r: any) => r.status), ['PASS', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED', 'UNSUPPORTED']);
});

test('invalid CLI usage and unknown selections exit nonzero', async () => {
  for (const args of [[], ['run', '--runtime', 'unknown', '--suite', 'current'], ['run', '--runtime', 'subprocess-reference', '--suite', 'unknown'], ['run', '--bad']]) {
    const errors: string[] = [];
    assert.equal(await runCli(args, () => assert.fail('Unexpected output'), s => errors.push(s)), 1);
    assert.equal(errors.length, 1);
  }
});
