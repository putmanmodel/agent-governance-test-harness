import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { validateQualification } from '../scripts/validate-qualification.ts';
import { referenceProfile } from '../scripts/portable-profiles.ts';

const profile = { runtimeId: 'fixture', suiteId: 'current', requiredPass: ['a'], expectedIds: ['a', 'b', 'c'] };
function report() {
  const results = ['c', 'a', 'b'].map(scenarioId => ({
    scenarioId, runtimeId: 'fixture', status: scenarioId === 'a' ? 'PASS' : 'UNSUPPORTED',
  }));
  return { runtimeId: 'fixture', suiteId: 'current', reportVersion: '1', results,
    summary: { passed: 1, failed: 0, unsupported: 2 } };
}
type Report = ReturnType<typeof report>;

test('reordered rows with optional UNSUPPORTED results qualify', () => {
  validateQualification(profile, report());
  const { expectedIds, ...minimum } = profile;
  validateQualification(minimum, report());
});

const invalid: [string, (r: Report) => void, RegExp][] = [
  ['required FAIL', r => { r.results[1].status = 'FAIL'; r.summary.passed--; r.summary.failed++; }, /must PASS/],
  ['required UNSUPPORTED', r => { r.results[1].status = 'UNSUPPORTED'; r.summary.passed--; r.summary.unsupported++; }, /must PASS/],
  ['missing required', r => { r.results.splice(1, 1); r.summary.passed--; }, /Missing expected/],
  ['duplicate required PASS', r => { r.results.push(r.results[1]); r.summary.passed++; }, /Duplicate scenario/],
  ['duplicate unsupported', r => { r.results.push(r.results[0]); r.summary.unsupported++; }, /Duplicate scenario/],
  ['count-preserving substitution', r => { r.results[0].scenarioId = 'b'; }, /Duplicate scenario: b/],
  ['unknown ID', r => { r.results[0].scenarioId = 'new'; }, /Unexpected scenario/],
  ['optional FAIL', r => { r.results[0].status = 'FAIL'; r.summary.failed++; r.summary.unsupported--; }, /contains FAIL/],
  ['wrong runtime', r => { r.runtimeId = 'other'; }, /Wrong report runtime/],
  ['wrong suite', r => { r.suiteId = 'other'; }, /Wrong suite/],
  ['wrong version', r => { r.reportVersion = '2'; }, /report version/],
  ['empty scenario ID', r => { r.results[0].scenarioId = '  '; }, /nonempty ID/],
  ['missing ID', r => { Reflect.deleteProperty(r.results[0], 'scenarioId'); }, /nonempty ID/],
  ['unknown status', r => { r.results[0].status = 'OK'; }, /Unknown status/],
  ['row runtime mismatch', r => { r.results[0].runtimeId = 'other'; }, /Wrong runtime for/],
  ['summary mismatch', r => { r.summary.passed++; }, /Summary disagrees/],
  ['malformed results', r => { Object.assign(r, { results: {} }); }, /results array/],
  ['malformed row', r => { Object.assign(r.results, { 0: null }); }, /Expected an object/],
];
for (const [name, mutate, error] of invalid) {
  test(name, () => {
    const r = report();
    mutate(r);
    assert.throws(() => validateQualification(profile, r), error);
  });
}
for (const field of ['requiredPass', 'expectedIds'] as const) {
  test('reject duplicate profile IDs in ' + field, () => {
    assert.throws(() => validateQualification({ ...profile, [field]: ['a', 'a'] }, report()), /Duplicate/);
  });
}
test('minimum profile still requires a row for each required ID', () => {
  const { expectedIds, ...minimum } = profile;
  assert.throws(() => validateQualification({ ...minimum, requiredPass: ['missing'] }, report()), /must PASS/);
});

// Inject the fault only into the JSON-producing Harness child of the actual smoke script.
for (const [name, fault, message] of [
  ['nonzero', 'process.exit(7)', /nonzero fixture/],
  ['aborted', 'process.kill(process.pid, "SIGTERM")', /aborted fixture/],
  ['truncated', 'process.stdout.write("{"); process.exit(0)', /JSON/],
  ['substitution', '', /Duplicate scenario: human-approval-replay/],
] as const) {
  test('release smoke rejects ' + name + ' child output', () => {
    const results = referenceProfile.expectedIds.map((scenarioId, i) => ({
      scenarioId, runtimeId: referenceProfile.runtimeId, status: i ? 'UNSUPPORTED' : 'PASS',
      missingCapabilities: i ? ['fixture'] : [],
    }));
    if (name === 'substitution') results[9] = results[1];
    const output = JSON.stringify({ reportVersion: '1', runtimeId: referenceProfile.runtimeId,
      suiteId: 'current', summary: { passed: 1, failed: 0, unsupported: 9 }, results });
    const injection = `if (process.argv[1]?.endsWith('harness-main.ts') && process.argv.includes('--json')) {
      console.error('${name} fixture');
      ${name === 'truncated' ? '' : 'console.log(' + JSON.stringify(output) + ');'}
      ${fault || 'process.exit(0)'}
    }`;
    const preload = 'data:text/javascript;base64,' + Buffer.from(injection).toString('base64');
    const child = spawnSync(process.execPath, ['scripts/release-smoke.mjs'], {
      encoding: 'utf8', timeout: 30_000, env: { ...process.env, NODE_OPTIONS: '--import=' + preload },
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1);
    assert.match(child.stderr, message);
  });
}
