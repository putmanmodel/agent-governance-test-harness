import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineRecord } from '../src/core/timeline.ts';
import { reviewRestartInvariant } from '../src/adapters/kingpin-rc2/review-restart-assertion.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/human-approval-consumption-survives-restart.rc2-gateway.jsonl', import.meta.url),'utf8').trim().split('\n').map(line => JSON.parse(line));
}
test('recorded consumed approval remains one-use after real restart', () => assert.equal(reviewRestartInvariant(recorded()).passed,true));
for (const mutation of ['replacement-db','pending','approved','missing-consumed-at','missing-history','wrong-review','binding-hash','request','decision','evaluation','principal','agent','context','no-exit','same-pid','overlap','accepted','ledger-growth','file-change','no-execution-before-exit']) {
 test(`review restart rejects ${mutation}`, () => {
  const timeline = recorded(); const record = timeline.find(r => r.category === 'governance')!;
  if (record.category !== 'governance') throw new Error('Missing evidence');
  const e = record.data.evidence.rc2_review_restart as any, r = e.b.snapshot.reviews[0];
  if (mutation === 'replacement-db') e.b.snapshot.database.ino++;
  if (mutation === 'pending' || mutation === 'approved') r.status = mutation;
  if (mutation === 'missing-consumed-at') r.consumed_at = null;
  if (mutation === 'missing-history') e.b.snapshot.events = e.b.snapshot.events.filter((x: any) => x.record.event_type !== 'review.execution_consumed');
  if (mutation === 'wrong-review') e.replay.path = '/reviews/wrong/execute';
  if (mutation === 'binding-hash') r.binding_hash = 'wrong';
  if (['request','decision','evaluation'].includes(mutation)) r[mutation+'_id'] = 'wrong';
  if (mutation === 'principal') e.b.identity.principal = 'other';
  if (mutation === 'agent') e.b.identity.agent = 'other';
  if (mutation === 'context') e.replay.body.session_id = 'other';
  if (mutation === 'no-exit') e.exitA = null;
  if (mutation === 'same-pid') e.b.pid = e.a.pid;
  if (mutation === 'overlap') [e.trace[3],e.trace[4]] = [e.trace[4],e.trace[3]];
  if (mutation === 'accepted') e.replay.response.status = 200;
  if (mutation === 'ledger-growth') e.replay.after.ledger.push({execution_id:'unauthorized'});
  if (mutation === 'file-change') e.replay.after.file.content = 'unauthorized';
  if (mutation === 'no-execution-before-exit') e.first.after.events = e.first.after.events.filter((x: any) => x.record.event_type !== 'tool.execution.succeeded');
  assert.equal(reviewRestartInvariant(timeline).passed,false);
 });
}
