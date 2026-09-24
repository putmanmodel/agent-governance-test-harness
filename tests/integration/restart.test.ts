import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRestart } from '../../src/adapters/kingpin-rc2/restart.ts';
test('real child A exits before B reopens durable state and denies fresh execution', async () => {
  const result = await runRestart();
  assert.equal(result.passed, true);
  const record = result.timeline.find(r => r.category === 'governance' && r.data.requestId === 'restart-after');
  assert.ok(record?.category === 'governance');
  const e = record.data.evidence.rc2_restart as any;
  assert.notEqual(e.a.pid, e.b.pid);
  assert.equal(e.exitA.code, 0); assert.equal(e.exitB.code, 0);
  for (const pid of [e.a.pid,e.b.pid]) assert.throws(() => process.kill(pid,0), (error: any) => error.code === 'ESRCH');
  assert.deepEqual(e.revocation.snapshot,e.b.snapshot);
  assert.equal(e.observation.receipt,null);
  assert.equal(e.observation.after.ledger.length,1);
  assert.deepEqual(e.observation.before.file,e.observation.after.file);
});
