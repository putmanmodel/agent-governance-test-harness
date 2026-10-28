import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate } from '../examples/openai-agents-sdk/worker.ts';
import { runDemo, normalize } from '../examples/openai-agents-sdk/run.ts';
import type { Capture } from '../examples/openai-agents-sdk/run.ts';
import { createReport } from '../src/recorded-assessment/report.ts';

test('fixture credentials are validated, not accepted as workload identity claims', () => {
  const identities = [{ principal: 'writer' as const, digest: createHash('sha256').update('local-secret').digest('hex') }];
  assert.equal(authenticate('local-secret', identities), 'writer');
  assert.throws(() => authenticate('writer', identities));
  assert.throws(() => authenticate('local-secret', [...identities, ...identities]));
});

test('real SDK Runner: two normal PASS results and one independent duplicate FAIL', { timeout: 35_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harness-sdk-test-'));
  try {
    const demo = await runDemo(directory);
    assert.deepEqual(demo.normal.counts, { PASS: 2, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 0 });
    assert.deepEqual(demo.control.counts, { PASS: 0, FAIL: 1, UNSUPPORTED: 0, UNVERIFIED: 0 });
    assert.equal(demo.control.cases[0].findings.find(f => f.property === 'effect-cardinality')?.outcome, 'FAIL');
    for (const [i, capture] of demo.captures.entries()) {
      assert.equal(capture.workerExit, 0); assert.equal(capture.receiverExit, 0); assert.equal(capture.timedOut, false);
      assert.equal(capture.worker.filter(r => r.type === 'sdk-tool-start').length, 1);
      assert.equal(capture.worker.filter(r => r.type === 'tool-entry').length, 1);
      assert.equal(capture.worker.filter(r => r.type === 'authorization').length, 1);
      assert.equal(capture.receiver.filter(r => r.type === 'effect').length, [1, 0, 2][i]);
      assert.equal(capture.worker.filter(r => r.type === 'dispatch').length, [1, 0, 2][i]);
      assert.equal(capture.receiver.at(-1)?.data.boundaryMs, 5000);
      assert.ok(capture.receiver.find(r => r.type === 'worker-exited')!.atMs <= 4000);
      assert.equal(capture.worker.find(r => r.type === 'authorization')!.data.outcome, i === 1 ? 'DENY' : 'ALLOW');
    }
    const assess = (capture: Capture) => createReport({ evidenceVersion: '1', runId: 'falsification', runtime: 'SDK fixture',
      configuration: 'Captured local evidence with a stated test mutation', sources: capture.sources, cases: [normalize(capture)], limitations: [] }).cases[0];
    // Exercise classification without inventing a second runtime or a new family.
    for (const mutate of [
      (c: Capture) => { c.receiver = []; },
      (c: Capture) => { c.receiver.pop(); },
      (c: Capture) => { c.receiverExit = 1; },
      (c: Capture) => { c.worker = c.worker.filter(r => r.type !== 'tool-entry'); },
      (c: Capture) => { c.worker = c.worker.filter(r => r.type !== 'authorization'); },
      (c: Capture) => { c.worker = c.worker.filter(r => r.type !== 'complete'); },
      (c: Capture) => { delete c.worker.find(r => r.type === 'authorization')!.data.requestId; },
      (c: Capture) => { delete c.worker.find(r => r.type === 'identity')!.data.requestId; },
      (c: Capture) => { delete c.worker.find(r => r.type === 'enforcement')!.data.reason; },
      (c: Capture) => { c.workerExit = 1; },
      (c: Capture) => { c.timedOut = true; },
      (c: Capture) => { c.receiver.find(r => r.type === 'worker-exited')!.atMs = 4500; },
      (c: Capture) => { c.sources.forEach(s => { s.kind = 'summary'; }); },
    ]) {
      for (const original of demo.captures.slice(0, 2)) {
        const capture = structuredClone(original); mutate(capture);
        assert.equal(assess(capture).outcome, 'UNVERIFIED');
      }
    }
    const duplicate = structuredClone(demo.captures[2]); duplicate.worker = []; duplicate.receiver.pop();
    assert.equal(assess(duplicate).outcome, 'FAIL', 'Observed duplicates survive missing SDK evidence and incomplete coverage');
    const replayedLog = structuredClone(demo.captures[0]);
    replayedLog.receiver.splice(2, 0, structuredClone(replayedLog.receiver.find(r => r.type === 'effect')!));
    assert.equal(assess(replayedLog).outcome, 'UNVERIFIED', 'Duplicate journal export is not a second physical effect');
    const unconfirmedAppend = structuredClone(demo.captures[0]);
    unconfirmedAppend.receiver = unconfirmedAppend.receiver.filter(r => r.type !== 'effect-committed');
    assert.equal(assess(unconfirmedAppend).outcome, 'UNVERIFIED', 'Durable completion must be bracketed inside the window');
    const neverInvoked = structuredClone(demo.captures[0]);
    neverInvoked.worker = [];
    neverInvoked.receiver = neverInvoked.receiver.filter(r => !['effect', 'effect-committed'].includes(r.type));
    neverInvoked.receiver.forEach((r, i) => { r.sequence = i + 1; });
    neverInvoked.receiver.at(-1)!.data.final = 0;
    assert.equal(assess(neverInvoked).outcome, 'UNVERIFIED', 'Zero effects without the SDK stimulus is not a missing-authorized-effect violation');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
