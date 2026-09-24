import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runUnknownRestart } from '../../src/adapters/kingpin-rc2/unknown-restart.ts';
test('real SIGKILL after physical write leaves STARTED and native startup reconciles without redispatch', async () => {
  const result = await runUnknownRestart(); assert.equal(result.passed,true);
  const r = result.timeline.find(r => r.category === 'governance'); assert.ok(r?.category === 'governance');
  const e = r.data.evidence.rc2_unknown_restart as any;
  assert.equal(e.exitA.signal,'SIGKILL'); assert.notEqual(e.a.pid,e.b.pid);
  for (const pid of [e.a.pid,e.b.pid]) assert.throws(()=>process.kill(pid,0),(err: any)=>err.code==='ESRCH');
  assert.equal(e.afterDeath.ledger[0].status,'started');
  assert.equal(e.b.snapshot.ledger[0].status,'reconciled_succeeded');
  assert.deepEqual(e.b.snapshot.events.slice(-2).map((x: any) => x.event_type),['tool.execution.unknown','tool.execution.reconciled_succeeded']);
  assert.equal(e.b.snapshot.calls.filter((x: any) => x.method === 'execute' && x.pid === e.a.pid).length,1);
  assert.equal(e.b.snapshot.calls.filter((x: any) => x.method === 'execute' && x.pid === e.b.pid).length,0);
  assert.deepEqual(e.afterDeath.file,e.b.snapshot.file);
});
