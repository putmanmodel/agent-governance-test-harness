import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineRecord } from '../src/core/timeline.ts';
import { unknownRestartInvariant } from '../src/adapters/kingpin-rc2/unknown-restart-assertion.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/unknown-execution-before-effect-survives-restart.rc2-gateway.jsonl', import.meta.url),'utf8').trim().split('\n').map(line => JSON.parse(line));
}
test('recorded before-effect crash reconciles absence without redispatch', () => assert.equal(unknownRestartInvariant(recorded()).passed,true));
const mutations: Record<string,(e: any) => void> = {
  'effect exists at barrier': e => { e.atBoundary.file = { exists: true, content: 'unexpected' }; },
  'STARTED never committed': e => { e.afterDeath.ledger = []; },
  'terminal receipt committed': e => { e.afterDeath.ledger[0].status = 'failed'; },
  'success claimed despite absence': e => {
    e.b.snapshot.ledger[0].status = 'reconciled_succeeded';
    e.b.snapshot.ledger[0].reconciliation.outcome = 'succeeded';
    e.b.snapshot.calls[1].outcome = 'succeeded';
    Object.assign(e.b.snapshot.events.at(-1), { event_type: 'tool.execution.reconciled_succeeded', outcome: 'reconciled_succeeded' });
    e.b.snapshot.events.at(-1).reconciliation.outcome = 'succeeded';
  },
  'second execution': e => { e.b.snapshot.ledger.push({...e.b.snapshot.ledger[0],execution_id:'second'}); },
  'B executes': e => { e.b.snapshot.calls.push({...e.afterDeath.calls[0],pid:e.b.pid}); },
  'effect appears during recovery': e => { e.b.snapshot.file = { exists:true,content:'unexpected' }; },
  'execution changes': e => { e.b.snapshot.ledger[0].execution_id = 'other'; },
  'UNKNOWN missing': e => { e.b.snapshot.events.splice(-2,1); },
  'reconciliation missing': e => { e.b.snapshot.events.pop(); },
  'A survives': e => { e.exitA.signal = null; },
  'replacement database': e => { e.b.before.database.ino++; },
  'replacement sandbox': e => { e.b.before.sandbox.ino++; },
  'native evidence records success before death': e => { e.afterDeath.events.push({...e.afterDeath.events.at(-1),event_type:'tool.execution.succeeded'}); },
  'journal records an effect despite absence': e => { e.afterDeath.calls.push({source:'harness:sandbox-call-observation',method:'physical-effect',pid:e.a.pid}); },
};
for (const [name,mutate] of Object.entries(mutations)) test(`before-effect rejects ${name}`, () => {
  const timeline = recorded(), r = timeline.find(r => r.category === 'governance');
  if (r?.category !== 'governance') throw new Error('Missing evidence');
  mutate(r.data.evidence.rc2_unknown_restart); assert.equal(unknownRestartInvariant(timeline).passed,false);
});
