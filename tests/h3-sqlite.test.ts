import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sqliteRotationCases } from '../scenarios/registrations.ts';
import { verifySqliteRotation } from '../src/adapters/kingpin-rc2/h3-sqlite-check.ts';

function recorded(id: typeof sqliteRotationCases[number]) {
  const file = new URL('../evidence/h3-sqlite/' + id + '.jsonl', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).data.evidence.sqliteRotation;
}
for (const id of sqliteRotationCases) test('retained ' + id, () => verifySqliteRotation(id, recorded(id)));
type Evidence = ReturnType<typeof recorded>;
const mutations: [string, RegExp, (e: Evidence) => void][] = [
  ['A reused as B', /distinct OS processes/, e => { e.b.exit.pid = e.b.observed.pid = e.a.exit.pid; }],
  ['overlapping lifetimes', /non-overlapping lifetimes/, e => { e.b.spawned = e.a.exited; }],
  ['fabricated child PID', /parent-observed PID/, e => { e.b.observed.pid = e.parentPid; }],
  ['copy with identical database contents', /original database/, e => {
    for (const s of [e.b.observed.opened,e.b.observed.closing,e.final]) s.database.ino++;
  }],
  ['missing invocation in gap', /gap journal integrity/, e => { e.gap.observer.pop(); }],
  ['truncated final journal', /final journal integrity/, e => {
    for (const s of [e.b.observed.closing,e.final]) s.observer = s.observer.filter((r: Evidence) => r.type === 'ready');
  }],
  ['stale prerestart journal', /final journal integrity/, e => {
    for (const s of [e.b.observed.closing,e.final]) s.observer = structuredClone(e.gap.observer);
  }],
  ['duplicate adapter entry, same file and receipt', /durable adapter cardinality/, e => {
    const stage = e.a.observed.success.after;
    const duplicate = { ...stage.entries[0], sequence: 2 };
    stage.entries.push(duplicate);
    for (const s of [e.a.observed.closing,e.gap,e.b.observed.opened,e.b.observed.closing,e.final]) {
      s.observer.splice(2,0,duplicate);
      s.calls.push(duplicate);
    }
  }],
  ['invalid B', /replacement identity/, e => { e.b.observed.replay.exchange.transport.principal = null; }],
  ['foreign principal', /replacement identity/, e => { e.b.observed.replay.exchange.transport.principal.principal_id = 'foreign'; }],
  ['original review UUID substituted', /original boundary UUID/, e => {
    e.b.observed.replay.calls[0].id = recorded('H3-SQLite-CR-01').a.observed.pending.review_id;
  }],
  ['ingress refusal with a conflict label', /consumption boundary/, e => {
    e.b.observed.replay.calls = [];
    e.b.observed.replay.audit = e.b.observed.retired.audit;
  }],
];
for (const [name,predicate,mutate] of mutations) test(name, () => {
  const e = recorded('H3-SQLite-CR-02');
  mutate(e);
  assert.throws(() => verifySqliteRotation('H3-SQLite-CR-02',e), predicate);
});
