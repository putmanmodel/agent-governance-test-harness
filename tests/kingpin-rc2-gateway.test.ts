import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateEffects } from '../src/adapters/kingpin-rc2/gateway.ts';
import type { GatewayEvidence } from '../src/adapters/kingpin-rc2/gateway.ts';

function evidence(events: string[]): GatewayEvidence {
  return { nativeRequestId: 'native-request', audit: events.map(event_type => ({
    event_type, request_id: 'native-request', execution_id: 'native-execution' })),
    ledgerBefore: [], ledgerAfter: [], fileBefore: { exists: false }, fileAfter: { exists: false },
  } as unknown as GatewayEvidence;
}

test('native execution events translate without treating permission as completion', () => {
  const observed = translateEffects('request-1', evidence(['tool.enforcement.allowed', 'tool.execution.started',
    'tool.execution.unknown', 'tool.execution.reconciled_succeeded']));
  assert.deepEqual(observed.executions.map(e => e.status), ['STARTED', 'UNKNOWN', 'SUCCEEDED']);
  assert.ok(observed.executions.every(e => e.reason.includes('native-execution')));
  assert.throws(() => translateEffects('request-1', evidence(['tool.enforcement.allowed'])), /no execution observation/);
  assert.equal(translateEffects('request-1', evidence(['tool.enforcement.allowed', 'tool.execution.failed'])).executions[0].status, 'FAILED');
});

test('blocked observation needs independent unchanged accounting and fixture evidence', () => {
  const blocked = evidence(['tool.enforcement.denied']);
  assert.equal(translateEffects('request-2', blocked).executions[0].status, 'NOT_STARTED');
  blocked.ledgerAfter.push({ request_id: 'native-request' });
  assert.throws(() => translateEffects('request-2', blocked), /changed execution accounting/);
  const changedFile = evidence(['tool.enforcement.denied']);
  changedFile.fileAfter = { exists: true };
  assert.throws(() => translateEffects('request-2', changedFile), /changed execution accounting/);
  assert.throws(() => translateEffects('request-2', evidence([])), /Missing or ambiguous/);
});
