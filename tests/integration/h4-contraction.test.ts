import assert from 'node:assert/strict';
import test from 'node:test';
import { contractionCases } from '../../scenarios/registrations.ts';
import { runSqliteRotation } from '../../src/adapters/kingpin-rc2/h3-sqlite.ts';
for (const id of contractionCases) {
  test(id,async () => {
    const result = await runSqliteRotation(id);
    assert.ok(result.passed,result.assertions[0].reason);
  });
  test(id + ' live FAIL when the change is omitted',async () => {
    const result = await runSqliteRotation(id,true);
    assert.equal(result.passed,false);
    assert.match(result.assertions[0].reason,id.endsWith('04') ? /authenticated scope/ : /authorized governance change/);
    const row = result.timeline[0];
    assert.ok(row.category === 'governance');
    const e = row.data.evidence.sqliteRotation as Record<string,any>;
    assert.equal(e.b.observed.refusal.exchange.response.status,200);
    assert.equal(e.final.calls.length,1);
    assert.equal(e.final.ledger[0].status,'succeeded');
  });
}
