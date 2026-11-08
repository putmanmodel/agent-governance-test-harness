import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runForeignReview } from '../../src/adapters/kingpin-rc2/foreign-review.ts';
test('authenticated B presenting A’s original approved operation is refused at ingress', async () => {
  const result = await runForeignReview();
  assert.ok(result.passed, result.assertions[0].reason);
});
