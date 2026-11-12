import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { memoryRotationCases } from '../scenarios/registrations.ts';
import { verifyRotation } from '../src/adapters/kingpin-rc2/h3-memory-check.ts';

function read(id: typeof memoryRotationCases[number]) {
  const file = new URL('../evidence/h3-memory/' + id + '.jsonl', import.meta.url);
  return JSON.parse(readFileSync(file, 'utf8').split('\n')[0]).data.evidence.rotation;
}
for (const id of memoryRotationCases) test('retained ' + id, () => verifyRotation(id, read(id)));
type Evidence = ReturnType<typeof read>;
const faults: [string, RegExp, (e: Evidence) => void][] = [
  ['foreign principal', /replacement identity/, e => { e.replay.exchange.transport.principal.principal_id = 'foreign'; }],
  ['agent substitution', /replacement identity/, e => { e.replay.exchange.transport.principal.agent_id = 'other'; }],
  ['another issued review', /original execute UUID/, e => { e.replay.exchange.transport.path =
    '/reviews/' + read('H3-Memory-CR-01').pending.review_id + '/execute'; }],
  ['stale post-response sample', /fresh samples/, e => { e.replay.after.seq = e.replay.before.seq; }],
  ['ingress relabeled as conflict', /consumption boundary/, e => { e.replay.calls = []; e.replay.audit = e.retired.audit; }],
];
for (const [name, pattern, mutate] of faults) test(name, () => {
  const e = read('H3-Memory-CR-02');
  mutate(e);
  assert.throws(() => verifyRotation('H3-Memory-CR-02', e), pattern);
});
for (const [name, pattern, mutate] of [
  ['duplicate entry', /adapter cardinality/, (s: Evidence) => { s.entries.push({ ...s.entries[0], sequence: 2 }); s.observer.calls.push(s.entries[0].operation); }],
  ['missing receipt', /receipt cardinality/, (s: Evidence) => { s.ledger = []; }],
  ['missing lifecycle', /execution lifecycle/, (s: Evidence) => { s.events = s.events.filter((v: Evidence) => v.event_type !== 'tool.execution.succeeded'); }],
  ['observer unreadable', /observer read/, (s: Evidence) => { s.observer = null; }],
  ['observer uninitialized', /observer read/, (s: Evidence) => { s.observer.ready = false; }],
] as const) test(name, () => {
  const e = read('H3-Memory-CR-01');
  // Coherently corrupt every post-execution sample. Preserve the file bytes and receipt where applicable.
  for (const sample of [e.success.after,e.replay.before,e.replay.after]) mutate(sample);
  assert.throws(() => verifyRotation('H3-Memory-CR-01', e), pattern);
});
