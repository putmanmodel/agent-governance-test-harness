import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReviewRestart } from '../../src/adapters/kingpin-rc2/review-restart.ts';
test('real approval consumption survives process replacement and direct original-review replay', async () => {
 const result = await runReviewRestart(); assert.equal(result.passed,true);
 const r = result.timeline.find(r => r.category === 'governance'); assert.ok(r?.category === 'governance');
 const e = r.data.evidence.rc2_review_restart as any;
 assert.notEqual(e.a.pid,e.b.pid);
 for (const pid of [e.a.pid,e.b.pid]) assert.throws(()=>process.kill(pid,0),(err: any)=>err.code==='ESRCH');
 assert.equal(e.replay.response.status,409); assert.equal(e.replay.response.body.authority_decision,undefined);
 assert.deepEqual(e.first.after,e.b.snapshot); assert.deepEqual(e.replay.before,e.replay.after);
 assert.equal(e.replay.after.ledger.length,1);
});
