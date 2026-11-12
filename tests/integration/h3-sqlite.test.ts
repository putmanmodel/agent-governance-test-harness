import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteRotationCases } from '../../scenarios/registrations.ts';
import { runSqliteRotation } from '../../src/adapters/kingpin-rc2/h3-sqlite.ts';
for (const id of sqliteRotationCases) test(id, async () => {
  const result = await runSqliteRotation(id);
  assert.ok(result.passed, result.assertions[0].reason);
});
