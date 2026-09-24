import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInFlightRevocation } from '../../src/adapters/kingpin-rc2/in-flight.ts';
import type { FlightEvidence } from '../../src/adapters/kingpin-rc2/in-flight-assertion.ts';

test('real STARTED write holds revocation pending, completes honestly, and blocks later dispatch', async () => {
  const result = await runInFlightRevocation();
  assert.equal(result.passed, true, result.assertions[0].reason);
  const decisions = result.timeline.filter(r => r.category === 'governance');
  const e = decisions[1].data.evidence.rc2_in_flight as FlightEvidence;
  assert.equal(e.started.ledger[0].status, 'started');
  assert.equal(e.held.fileExists, false);
  assert.equal(e.acknowledgementWhileHeld, false);
  assert.equal(e.cancellation_supported, false);
  assert.equal(e.first.receipt.status, 'succeeded');
  assert.equal(e.first.file.content, 'deterministic governance fixture\n');
  assert.equal(e.first.ledger.length, 1);
  assert.deepEqual(e.first.ledger, e.later!.after.ledger);
  assert.deepEqual(e.first.file, e.later!.after.file);
  assert.equal(e.later!.response.status, 403);
  assert.notEqual(e.first.response.requestId, e.later!.response.requestId);
  const completed = e.afterFirst.events.find(r => r.record.event_type === 'tool.execution.succeeded')!;
  const revoked = e.afterFirst.events.find(r => r.record.event_type === 'capability.revoked')!;
  assert.ok(completed.sequence < revoked.sequence);
  assert.ok(e.trace.findIndex(r => r.event === 'revocation-request-sent') < e.trace.findIndex(r => r.event === 'barrier-release'));
  assert.deepEqual(result.timeline.filter(r => r.category === 'execution').map(r => r.data.status), ['STARTED', 'SUCCEEDED', 'NOT_STARTED']);
});
