import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineRecord } from '../src/core/timeline.ts';
import { restartInvariant } from '../src/adapters/kingpin-rc2/restart-assertion.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/capability-revocation-survives-restart.rc2-gateway.jsonl', import.meta.url),'utf8').trim().split('\n').map(line => JSON.parse(line));
}
test('recorded real process replacement preserves revoked capability', () => assert.equal(restartInvariant(recorded()).passed, true));
for (const mutation of ['empty-store','missing-revocation','no-exit','same-process','changed-principal','changed-context','old-evaluation','old-decision','resurrected-allow','second-execution','changed-file','wrong-capability','wrong-scope','overlap']) {
  test(`restart invariant rejects ${mutation}`, () => {
    const timeline = recorded(), records = timeline.filter(r => r.category === 'governance');
    const e = records[1].data.evidence.rc2_restart as any;
    const before = e.first.audit.find((r: any) => r.event_type === 'authority.decision');
    const after = e.observation.audit.find((r: any) => r.event_type === 'authority.decision');
    if (mutation === 'empty-store') { e.b.snapshot.events = []; e.b.snapshot.database.ino++; }
    if (mutation === 'missing-revocation') e.b.snapshot.revocations = [];
    if (mutation === 'no-exit') e.exitA = null;
    if (mutation === 'same-process') e.b.pid = e.a.pid;
    if (mutation === 'changed-principal') e.b.identity.principal = 'other';
    if (mutation === 'changed-context') after.context.session_id = 'other';
    if (mutation === 'old-evaluation') after.evaluation_id = before.evaluation_id;
    if (mutation === 'old-decision') after.decision_id = before.decision_id;
    if (mutation === 'resurrected-allow') { after.outcome = 'allow'; records[1].data.result = 'ALLOW'; }
    if (mutation === 'second-execution') e.observation.after.ledger.push({ execution_id: 'unauthorized' });
    if (mutation === 'changed-file') e.observation.after.file.content = 'unauthorized';
    if (mutation === 'wrong-capability') e.revocation.response.body.target.tool = 'fs.read';
    if (mutation === 'wrong-scope') e.revocation.response.body.context.speaker_id = 'other';
    if (mutation === 'overlap') { const i = e.trace.indexOf('A-exited'); [e.trace[i],e.trace[i+1]] = [e.trace[i+1],e.trace[i]]; }
    assert.equal(restartInvariant(timeline).passed, false);
  });
}
