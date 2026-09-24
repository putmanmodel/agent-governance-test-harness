import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterRevocation, revokedAuthorityInvariant } from '../scenarios/retry-after-revocation.ts';
import { SimulatedRuntimeAdapter } from '../src/adapters/simulated-runtime-adapter.ts';
import { runScenario } from '../src/core/runner.ts';
import { toJsonl } from '../src/reporters/jsonl-reporter.ts';
import { Timeline } from '../src/core/timeline.ts';

test('deterministic replay produces byte-identical ordered JSONL', async () => {
  const first = await runScenario(retryAfterRevocation, new SimulatedRuntimeAdapter());
  const replay = await runScenario(retryAfterRevocation, new SimulatedRuntimeAdapter());
  assert.equal(toJsonl(first.timeline), toJsonl(replay.timeline));
  assert.ok(first.timeline.every(record => record.harness_schema_version === '1'));
  assert.deepEqual(toJsonl(first.timeline).trim().split('\n').map(line => JSON.parse(line)), first.timeline);
});

test('timeline captures the full sequence in scenario-defined order', async () => {
  const result = await runScenario({ ...retryAfterRevocation, events: [...retryAfterRevocation.events].reverse() }, new SimulatedRuntimeAdapter());
  assert.deepEqual(result.timeline.map(r => r.sequence), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(result.timeline.map(r => r.eventOrder), [1, 2, 2, 2, 2, 2, 3, 4, 4, 4, 4, 4]);
  assert.deepEqual(result.timeline.map(r => r.timestamp), [0, 1, 1, 1, 1, 1, 2, 3, 3, 3, 3, 3]);
  assert.deepEqual(result.timeline.map(r => r.category), [
    'scenario', 'scenario', 'governance', 'enforcement', 'execution', 'execution',
    'scenario', 'scenario', 'governance', 'enforcement', 'execution', 'assertion',
  ]);
});

test('timeline snapshots cannot mutate captured evidence', () => {
  const timeline = new Timeline();
  const event = structuredClone(retryAfterRevocation.events[0]);
  timeline.append('test', event, { category: 'scenario', data: event });
  event.timestamp = 99;
  const snapshot = timeline.snapshot();
  snapshot[0].timestamp = 88;
  assert.equal(timeline.snapshot()[0].timestamp, 0);
  const captured = timeline.snapshot()[0];
  assert.equal(captured.category, 'scenario');
  if (captured.category === 'scenario') assert.equal(captured.data.timestamp, 0);
});

test('retry after revocation is independently denied without execution', async () => {
  const result = await runScenario(retryAfterRevocation, new SimulatedRuntimeAdapter());
  assert.equal(result.passed, true);
  assert.equal(result.assertions[0].passed, true);
  assert.deepEqual(result.timeline.filter(r => r.category === 'governance').map(r => r.data.result), ['ALLOW', 'DENY']);
  assert.equal(revokedAuthorityInvariant([]).passed, false);
  assert.equal(revokedAuthorityInvariant(result.timeline.filter(r => r.category !== 'governance')).passed, false);
});

test('broken adapter reusing revoked authority fails the invariant', async () => {
  const result = await runScenario(retryAfterRevocation, new SimulatedRuntimeAdapter({ reuseRevokedAuthority: true }));
  assert.equal(result.passed, false);
  assert.equal(result.assertions[0].passed, false);
  assert.ok(result.timeline.some(r => r.category === 'execution' && r.data.requestId === 'request-2' && r.data.status === 'STARTED'));
});
