import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { memoryRotationCases } from '../../scenarios/registrations.ts';
import { runMemoryRotation } from '../../src/adapters/kingpin-rc2/h3-memory.ts';

for (const id of memoryRotationCases) test(id, async () => {
  const result = await runMemoryRotation(id);
  assert.ok(result.passed, result.assertions[0].reason);
});

// Change only the final outbound replay. The collector still sees what the
// client intended. The server's independent boundary and response must disagree.
for (const fault of ['invalid bearer', 'reviewer bearer', 'other review']) test(fault, async t => {
  const fetch = globalThis.fetch;
  let count = 0, reviewer = '', status = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/approve')) reviewer = new Headers(init.headers).get('authorization')!;
    if (url.endsWith('/execute') && ++count === 3) {
      if (fault === 'other review') url = url.replace(/\/reviews\/[^/]+/, '/reviews/' + randomUUID());
      else {
        const headers = new Headers(init.headers);
        headers.set('authorization', fault === 'invalid bearer' ? 'Bearer ' + randomBytes(32).toString('hex') : reviewer);
        init = { ...init, headers };
      }
      const response = await fetch(url, init);
      status = response.status;
      return response;
    }
    return fetch(url, init);
  });
  const result = await runMemoryRotation('H3-Memory-CR-02');
  assert.equal(count, 3);
  assert.equal(status, fault === 'invalid bearer' ? 401 : fault === 'reviewer bearer' ? 403 : 409);
  assert.equal(result.passed, false);
  assert.match(result.assertions[0].reason, fault === 'other review' ? /original boundary UUID/ : /consumed conflict/);
});

test('duplicate real adapter entry with one receipt and identical file contents', async () => {
  const result = await runMemoryRotation('H3-Memory-CR-01', adapter => ({
    ...adapter, execute(request) {
      adapter.execute(request);
      return adapter.execute(request);
    },
  }));
  const row = result.timeline[0];
  assert.ok(row.category === 'governance');
  const { success } = (row.data.evidence.rotation as Record<string, any>);
  assert.equal(success.after.entries.length, 2);
  assert.equal(success.after.ledger.length, 1);
  assert.equal(success.after.file.content, success.after.entries[0].operation.args.content);
  assert.equal(result.passed, false);
  assert.match(result.assertions[0].reason, /adapter cardinality/);
});
