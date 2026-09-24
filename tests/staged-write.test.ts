import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stagedInvariant } from '../src/adapters/kingpin-rc2/staged-assertion.ts';
import type { TimelineRecord } from '../src/core/timeline.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/staged-write-after-revocation.rc2-gateway.jsonl', import.meta.url), 'utf8').trim().split('\n').map(line => JSON.parse(line));
}
test('recorded staged write proves fresh authority with no target effect', () => assert.equal(stagedInvariant(recorded()).passed, true));
for (const mutation of ['decision', 'evaluation', 'missing-revocation', 'wrong-capability', 'wrong-resource', 'late-revocation', 'provenance-permission', 'effect-after-denial', 'premature-effect', 'wrong-link', 'second-ledger']) {
  test(`staged invariant rejects ${mutation}`, () => {
    const timeline = recorded();
    const records = timeline.filter(r => r.category === 'governance');
    const x = records[0].data.evidence.rc2_staged as any, y = records[1].data.evidence.rc2_staged as any;
    const first = x.audit.find((r: any) => r.event_type === 'authority.decision');
    const later = y.audit.find((r: any) => r.event_type === 'authority.decision');
    if (mutation === 'decision') later.decision_id = first.decision_id;
    if (mutation === 'evaluation') later.evaluation_id = first.evaluation_id;
    if (mutation === 'missing-revocation') y.revocation = null;
    if (mutation === 'wrong-capability') y.revocation.response.body.target.tool = 'fs.read';
    if (mutation === 'wrong-resource') y.revocation.input.args.path = 'other.txt';
    if (mutation === 'late-revocation') y.nativeSequence.find((r: any) => r.record.event_type === 'capability.revoked').sequence = 99999;
    if (mutation === 'provenance-permission') { later.outcome = 'allow'; records[1].data.result = 'ALLOW'; }
    if (mutation === 'effect-after-denial') y.after.files.target = { exists: true, content: 'unauthorized' };
    if (mutation === 'premature-effect') x.after.files.target.exists = true;
    if (mutation === 'wrong-link') y.input.harness_provenance.target_resource = 'other.txt';
    if (mutation === 'second-ledger') y.after.ledger.push({ execution_id: 'unauthorized' });
    assert.equal(stagedInvariant(timeline).passed, false);
  });
}
