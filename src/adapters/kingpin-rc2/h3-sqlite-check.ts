import assert from 'node:assert/strict';
import type { sqliteRotationCases } from '../../../scenarios/registrations.ts';
import { canonical } from './approved-restart-binding.ts';
import { verifyRotationObservations } from './h3-memory-check.ts';

type Native = Record<string, any>;
function checkDurable(snapshot: Native, sample: Native) {
  assert.deepEqual(snapshot.reviews, [sample.review], 'persisted original review');
  assert.deepEqual(snapshot.ledger, sample.ledger, 'persisted receipt');
  assert.deepEqual(snapshot.calls, sample.entries, 'durable invocation journal');
  assert.deepEqual(snapshot.directory, sample.directory);
  assert.deepEqual(snapshot.file, sample.file);
  const { context_key, ...state } = snapshot.contexts[0];
  assert.equal(snapshot.contexts.length, 1);
  assert.equal(context_key, canonical(sample.review.context));
  assert.deepEqual(state, sample.authority.context);
  assert.deepEqual(snapshot.revocations, []);
  assert.equal(snapshot.metadata[0].policy_fingerprint, sample.review.policy_fingerprint);
  const history = snapshot.events.filter((v: Native) => v.request_id === sample.review.request_id);
  // SQLite exposes native records via HTTP. The independent SQL reader also retains its sequence column.
  assert.deepEqual(history.map(({ sequence, ...record }: Native) => record),
    sample.events.map(({ sequence, ...record }: Native) => record));
  assert.deepEqual(snapshot.events.filter((v: Native) => v.event_type.startsWith('tool.execution.')),
    history.filter((v: Native) => v.event_type.startsWith('tool.execution.')), 'unrelated execution lifecycle');
}

export function verifyRestart(e: Native) {
  const { a, b, gap, final } = e, first = a.observed, second = b.observed;
  const pids = { A: a.exit.pid, B: b.exit.pid };
  assert.ok([pids.A, pids.B,e.parentPid].every(pid => Number.isSafeInteger(pid) && pid > 0)
    && new Set([pids.A,pids.B,e.parentPid]).size === 3, 'distinct OS processes');
  for (const p of [a,b]) {
    assert.equal(p.observed.pid, p.exit.pid, 'parent-observed PID');
    assert.deepEqual([p.exit.code,p.exit.signal], [0,null]);
  }
  const order = [a.spawned,a.exited,e.gapRead,b.spawned,b.exited,e.finalRead];
  assert.ok(order.every((v,i) => Number.isFinite(v) && (i === 0 || v > order[i-1])), 'non-overlapping lifetimes');
  const readyA = { type: 'ready', phase: 'A', pid: pids.A }, readyB = { type: 'ready', phase: 'B', pid: pids.B };
  assert.deepEqual(first.opened.observer, [readyA], 'A observer ready');
  assert.deepEqual(first.opened.ledger, []);
  assert.deepEqual(first.opened.reviews, []);
  assert.deepEqual(first.opened.calls, []);
  assert.equal(first.opened.file.exists, false);
  for (const key of ['database','sandbox']) {
    const identity = first.opened[key];
    assert.ok(Number.isSafeInteger(identity.dev) && Number.isSafeInteger(identity.ino) && identity.ino > 0);
    for (const snap of [first.closing,gap,second.opened,second.closing,final]) {
      assert.deepEqual(snap[key], identity, 'original ' + key);
    }
  }
  return { readyA, readyB, pids };
}

export function verifySqliteRotation(id: typeof sqliteRotationCases[number], e: Native) {
  const { readyA, readyB, pids } = verifyRestart(e);
  const { a, b, gap, final } = e, first = a.observed, second = b.observed;
  const consumedInB = id.endsWith('01');
  const success = consumedInB ? second.success : first.success;
  const stageA = consumedInB ? first.approved : success.after;
  const rowsA = consumedInB ? [readyA] : [readyA,...stageA.entries];
  assert.deepEqual(gap.observer, rowsA, 'gap journal integrity');
  assert.deepEqual(gap, first.closing, 'post-exit A snapshot');
  assert.deepEqual(second.opened, { ...gap, observer: [...rowsA,readyB] }, 'B reopened original state');
  assert.deepEqual(final, second.closing, 'post-exit B snapshot');
  assert.deepEqual(final.observer, consumedInB ? [readyA,readyB,...success.after.entries] : [...rowsA,readyB], 'final journal integrity');
  assert.deepEqual(final.calls, final.observer.filter((v: Native) => v.type === 'execute'), 'journal cardinality');
  assert.equal(final.calls.length, 1, 'durable adapter cardinality');
  assert.equal(final.calls[0].pid, consumedInB ? pids.B : pids.A, 'adapter PID');
  checkDurable(gap, stageA);
  checkDurable(second.opened, second.retired.before);
  checkDurable(final, second.replay.after);
  assert.deepEqual(final.events.slice(0,gap.events.length), gap.events, 'durable audit prefix');
  const rejection = final.events.filter((v: Native) => v.request_id === second.retired.exchange.response.requestId);
  assert.ok(rejection.some((v: Native) => v.event_type === 'authentication.rejected'));
  verifyRotationObservations(id, { ...first, success, retired: second.retired, replay: second.replay }, pids);
}
