import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStagedWrite } from '../../src/adapters/kingpin-rc2/staged.ts';
test('real RC2 stages inert work then denies fresh target execution after acknowledged revocation', async () => {
  const result = await runStagedWrite();
  assert.equal(result.passed, true);
  const records = result.timeline.filter(r => r.category === 'governance');
  const x = records[0].data.evidence.rc2_staged as any, y = records[1].data.evidence.rc2_staged as any;
  assert.equal(x.receipt.status, 'succeeded');
  assert.equal(x.after.files.target.exists, false);
  assert.equal(y.after.files.target.exists, false);
  assert.deepEqual(y.after.ledger, x.after.ledger);
  assert.equal(y.after.ledger.length, 1);
  assert.equal(y.response.body.authority_decision.outcome, 'deny');
  assert.notEqual(y.response.body.top_event.event_id, x.response.body.top_event.event_id);
});
