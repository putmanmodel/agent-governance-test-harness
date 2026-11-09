import assert from 'node:assert/strict';

function object(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object');
}

function id(value: unknown): asserts value is string {
  assert.ok(typeof value === 'string' && value.trim().length > 0, 'Expected a nonempty ID');
}

function profileIds(value: unknown, field: string): Set<string> {
  assert.ok(Array.isArray(value), `Expected an array for ${field}`);
  const ids = new Set<string>();
  for (const item of value) {
    id(item);
    assert.ok(!ids.has(item), `Duplicate ${field} ID: ${item}`);
    ids.add(item);
  }
  return ids;
}

export function validateQualification(profile: unknown, report: unknown): void {
  object(profile);
  id(profile.runtimeId);
  id(profile.suiteId);
  const required = profileIds(profile.requiredPass, 'requiredPass');
  const expected = 'expectedIds' in profile ? profileIds(profile.expectedIds, 'expectedIds') : undefined;

  object(report);
  assert.equal(report.reportVersion, '1', 'Unsupported report version');
  assert.equal(report.runtimeId, profile.runtimeId, 'Wrong report runtime');
  assert.equal(report.suiteId, profile.suiteId, 'Wrong suite');
  assert.ok(Array.isArray(report.results), 'Expected a results array');
  const statuses = new Map<string, string>();
  const counts = { passed: 0, failed: 0, unsupported: 0 };
  for (const row of report.results) {
    object(row);
    id(row.scenarioId);
    assert.equal(row.runtimeId, profile.runtimeId, `Wrong runtime for ${row.scenarioId}`);
    assert.ok(!statuses.has(row.scenarioId), `Duplicate scenario: ${row.scenarioId}`);
    assert.ok(!expected || expected.has(row.scenarioId), `Unexpected scenario: ${row.scenarioId}`);
    switch (row.status) {
      case 'PASS': counts.passed++; break;
      case 'FAIL': counts.failed++; break;
      case 'UNSUPPORTED': counts.unsupported++; break;
      default: throw new Error(`Unknown status for ${row.scenarioId}`);
    }
    statuses.set(row.scenarioId, row.status);
  }
  assert.deepEqual(report.summary, counts, 'Summary disagrees with result rows');
  for (const scenario of expected ?? []) {
    assert.ok(statuses.has(scenario), `Missing expected scenario: ${scenario}`);
  }
  for (const scenario of required) {
    assert.equal(statuses.get(scenario), 'PASS', `Required scenario must PASS: ${scenario}`);
  }
  assert.equal(counts.failed, 0, 'Suite contains FAIL results');
}
