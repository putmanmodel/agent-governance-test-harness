import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { contractionCases, sqliteRotationCases } from '../../../scenarios/registrations.ts';
import { Timeline } from '../../core/timeline.ts';
import { harnessProvenance } from './approved-restart-provenance.ts';
import { rotationTarget } from './h3-memory.ts';
import { startRestartChild } from './restart-process.ts';
import { durableSnapshot } from './h3-sqlite-snapshot.ts';
import { verifyContraction } from './h4-check.ts';
import { verifySqliteRotation } from './h3-sqlite-check.ts';

export async function runSqliteRotation(id: typeof sqliteRotationCases[number] | typeof contractionCases[number], omitChange = false) {
  const runtime = rotationTarget(), harness = harnessProvenance();
  const root = mkdtempSync(join(tmpdir(), 'h3-sqlite-'));
  const token = () => randomBytes(32).toString('base64url');
  const retired = token(), replacement = token(), reviewer = token(), tagKey = token();
  const entry = new URL('./h3-sqlite-child.ts', import.meta.url);
  const now = () => performance.now();
  async function phase(mode: 'create' | 'reopen', seq: number, anchor?: unknown) {
    const spawned = now(), child = startRestartChild(entry, root, mode, [id]);
    try {
      const observed = await child.rpc('run', { seq, anchor, omitChange, credentials: { retired, reviewer, tagKey,
        agent: mode === 'create' ? retired : replacement } });
      const exit = await child.close(), exited = now();
      assert.equal(exit.code, 0);
      return { spawned, observed, exit, exited };
    } catch (error) { await child.close(); throw error; }
  }
  try {
    const a = await phase('create', 0);
    const gap = durableSnapshot(root), gapRead = now();
    const b = await phase('reopen', a.observed.seq, a.observed.anchor);
    const final = durableSnapshot(root), finalRead = now();
    assert.deepEqual(rotationTarget(), runtime);
    const evidence = { a, gap, gapRead, b, final, finalRead, parentPid: process.pid };
    let passed = true, reason = 'SQLite restart and scenario predicates passed';
    try {
      if (id === 'H3-SQLite-CR-01' || id === 'H3-SQLite-CR-02') verifySqliteRotation(id, evidence);
      else verifyContraction(id, evidence);
    } catch (error) { passed = false; reason = String(error); }
    const assertion = { invariantId: id, name: id, passed, reason, evidence: [1] };
    const timeline = new Timeline();
    timeline.append(id, { order: 1, timestamp: 0 }, { category: 'governance', data: {
      requestId: a.observed.proposal.response.requestId, decisionId: a.observed.pending.decision_id,
      result: 'INDETERMINATE', rationale: 'Original human review', evidence: { sqliteRotation: evidence, runtime, harness } } });
    timeline.append(id, { order: 2, timestamp: 1 }, { category: 'assertion', data: assertion });
    return { passed, assertions: [assertion], timeline: timeline.snapshot() };
  } finally { rmSync(root, { recursive: true, force: true }); }
}
