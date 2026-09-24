import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineRecord } from '../src/core/timeline.ts';
import { unknownRestartInvariant } from '../src/adapters/kingpin-rc2/unknown-restart-assertion.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/unknown-execution-survives-restart.rc2-gateway.jsonl', import.meta.url),'utf8').trim().split('\n').map(line => JSON.parse(line));
}
function evidence(timeline: TimelineRecord[]) {
  const r = timeline.find(r => r.category === 'governance');
  if (r?.category !== 'governance') throw new Error('Missing evidence');
  return r.data.evidence.rc2_unknown_restart as any;
}
test('recorded real crash recovers without redispatch', () => assert.equal(unknownRestartInvariant(recorded()).passed,true));
const mutations: Record<string, (e: any) => void> = {
  'no genuine death': e => { e.exitA.signal = null; },
  'crash before physical effect': e => { e.atBoundary.file.exists = false; },
  'terminal success committed': e => { e.afterDeath.ledger[0].status = 'succeeded'; },
  'replacement database': e => { e.b.before.database.ino++; },
  'same process': e => { e.b.pid = e.a.pid; },
  'changed execution': e => { e.b.snapshot.ledger[0].execution_id = 'other'; },
  'changed request': e => { e.b.snapshot.ledger[0].request_id = 'other'; },
  'changed decision': e => { e.b.snapshot.ledger[0].decision_id = 'other'; },
  'changed evaluation': e => { e.b.snapshot.ledger[0].evaluation_id = 'other'; },
  'missing UNKNOWN': e => { e.b.snapshot.events = e.b.snapshot.events.filter((x: any) => x.event_type !== 'tool.execution.unknown'); },
  'second ledger entry': e => { e.b.snapshot.ledger.push({ ...e.b.snapshot.ledger[0], execution_id: 'second' }); },
  'second execute': e => { e.b.snapshot.calls.push({ ...e.afterDeath.calls[0], pid: e.b.pid }); },
  'changed physical effect': e => { e.b.snapshot.file.content += 'duplicate'; },
  'fresh governance on recovery': e => { e.b.snapshot.events.push({ event_type: 'authority.decision', outcome: 'allow' }); },
  'discarded STARTED': e => { e.b.before.ledger = []; },
  'overlapping ownership': e => { e.released.acquired = false; },
  'B starts before ownership release': e => { [e.trace[5],e.trace[6]] = [e.trace[6],e.trace[5]]; },
  'missing physical reconciliation': e => { e.b.snapshot.calls.pop(); },
  'claimed reconciliation outcome': e => { e.b.snapshot.calls[1].outcome = 'inconclusive'; },
  'missing original CDE': e => { e.afterDeath.events = e.afterDeath.events.filter((x: any) => x.event_type !== 'cde.signal.created'); },
  'changed reconciliation binding': e => { e.b.snapshot.calls[1].evidence.expected_hash = 'other'; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`crash recovery rejects ${name}`, () => {
  const timeline = recorded(); mutate(evidence(timeline)); assert.equal(unknownRestartInvariant(timeline).passed,false);
});
test('honest native reconciliation_required is not forced into success', () => {
  const timeline = recorded(), e = evidence(timeline), final = e.b.snapshot.ledger[0], event = e.b.snapshot.events.at(-1);
  final.status = 'reconciliation_required'; final.completed_at = null; final.reconciliation.outcome = 'inconclusive';
  event.event_type = 'tool.execution.reconciliation_required'; event.outcome = final.status;
  event.reconciliation.outcome = 'inconclusive'; e.b.snapshot.calls[1].outcome = 'inconclusive';
  // A corresponding observer reports only STARTED/UNKNOWN, with native disposition retained in evidence.
  const terminal = timeline.findIndex(r => r.category === 'execution' && r.data.status === 'SUCCEEDED');
  if (terminal >= 0) timeline.splice(terminal,1);
  assert.equal(unknownRestartInvariant(timeline).passed,true);
});
