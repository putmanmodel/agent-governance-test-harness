import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimelineRecord } from '../src/core/timeline.ts';
import { approvedRestartInvariant, approvedRestartChecks } from '../src/adapters/kingpin-rc2/approved-restart-assertion.ts';
import { snapshotsOf } from '../src/adapters/kingpin-rc2/approved-restart-checks.ts';
import { requestBinding, bindingHash } from '../src/adapters/kingpin-rc2/approved-restart-binding.ts';
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/approved-review-revocation-survives-restart.rc2-gateway.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line));
}
test('recorded approved review cannot bypass capability revocation after restart', () => assert.equal(approvedRestartInvariant(recorded()).passed, true));
const mutations: Record<string, (e: any) => void> = {
  'invalid initial approval': e => { e.first.approval.body.ready_for_consumption = false; },
  'wrong revocation scope': e => { e.first.revoke.body.context.session_id = 'other'; },
  'revocation in wrong order': e => { e.replay.after.events.find((a: any) => a.event_type === 'capability.revoked').sequence = 0; },
  'replacement database': e => { e.b.snapshot.database.ino++; },
  'overlapping processes': e => { [e.trace[3], e.trace[4]] = [e.trace[4], e.trace[3]]; },
  'changed request binding': e => { e.replay.body.plan_id = 'different-operation'; },
  'generic refusal': e => { e.replay.response.body.reason = 'REQUEST_BINDING_CHANGED'; },
  'missing review invalidation': e => { e.replay.review.body.status = 'approved'; },
  'fabricated native decision': e => { e.replay.response.body.authority_decision = { outcome: 'deny' }; },
  'wrong original review': e => { e.replay.path = '/reviews/other/execute'; },
  'missing original audit': e => { e.replay.originalAudit = []; },
  'altered historical approval': e => { e.replay.review.body.resolution = 'deny'; },
  'consumed approval': e => { e.replay.review.body.consumed_at = new Date().toISOString(); },
};
for (const [name, mutate] of Object.entries(mutations)) test(`approved restart rejects ${name}`, () => {
  const timeline = recorded(), record = timeline.find(r => r.category === 'governance');
  assert.ok(record?.category === 'governance');
  mutate(record.data.evidence.rc2_approved_restart);
  assert.equal(approvedRestartInvariant(timeline).passed, false);
});
test('approved restart fails closed on missing evidence', () => assert.equal(approvedRestartInvariant([]).passed, false));

// Coherent mutations preserve redundant copies; unlike single-field damage they
// exercise semantic checks rather than merely detecting inconsistent snapshots.

function walk(value: any, visit: (v: any) => void) {
  if (value && typeof value === 'object') { visit(value); Object.values(value).forEach(v => walk(v, visit)); }
}
function evidence(t: TimelineRecord[]) {
  const r = t.find(r => r.category === 'governance');
  assert.ok(r?.category === 'governance'); return r.data.evidence.rc2_approved_restart as any;
}
const coherent: Record<string, { check: string; mutate(t: TimelineRecord[], e: any): void }> = {
  'all request copies changed against unchanged review binding': { check: 'request_binding', mutate(t,e) {
    for (const b of [e.a.identity.body,e.b.identity.body,e.first.body,e.replay.body]) b.args.path = 'wrong.txt';
  } },
  'all review binding hashes corrupted': { check: 'request_binding', mutate(t,e) {
    walk(e, v => { if ('binding_hash' in v) v.binding_hash = '0'.repeat(64); });
  } },
  'wrong approved operation with coherently recomputed binding': { check: 'request_binding', mutate(t,e) {
    for (const b of [e.a.identity.body,e.b.identity.body,e.first.body,e.replay.body]) b.args.path = 'wrong.txt';
    const b = requestBinding(e.replay.body, e.first.approval.body.review.principal_id);
    walk(e, v => { if ('binding_hash' in v) { v.binding = structuredClone(b); v.binding_hash = bindingHash(b); } });
    e.a.nativeBinding = e.b.nativeBinding = e.replay.nativeBinding = b;
  } },
  'initial native authority audit missing coherently': { check: 'initial_native_audit', mutate(t,e) {
    walk(e, v => { for (const k of ['events','audit','originalAudit']) if (Array.isArray(v[k])) v[k] = v[k].filter((a: any) => a.event_type !== 'authority.decision'); });
  } },
  ...Object.fromEntries(['allow','deny'].map(outcome => [`initial native authority coherently ${outcome}`, {
    check: 'initial_native_audit', mutate(t: TimelineRecord[],e: any) { walk(e,v => { if (v.event_type === 'authority.decision') v.outcome = outcome; }); }
  }])),
  'initial native authority wrong decision correlation': { check: 'initial_native_audit', mutate(t,e) {
    walk(e,v => { if (v.event_type === 'authority.decision') v.decision_id = 'another-decision'; });
  } },
  'initial native authority wrong request correlation': { check: 'initial_native_audit', mutate(t,e) {
    walk(e,v => { if (v.event_type === 'authority.decision') v.request_id = 'another-request'; });
  } },
  'initial native authority duplicate': { check: 'initial_native_audit', mutate(t,e) {
    walk(e,v => { for (const k of ['events','audit','originalAudit']) if (Array.isArray(v[k])) {
      const d = v[k].find((a: any) => a.event_type === 'authority.decision'); if (d) v[k].push(structuredClone(d));
    } });
  } },
  'approved eligibility contradicts ALLOWED': { check: 'review_transition', mutate(t,e) {
    walk(e,v => { if (v.status === 'approved') v.execution.reason = 'CAPABILITY_REVOKED'; });
  } },
  'invalidation event removed with invalidated state retained': { check: 'review_transition', mutate(t,e) {
    walk(e,v => { for (const k of ['events','audit','originalAudit']) if (Array.isArray(v[k])) v[k] = v[k].filter((a: any) => a.event_type !== 'review.invalidated'); });
  } },
  'invalidation event remains but state stays approved': { check: 'lifecycle_continuity', mutate(t,e) {
    const approved = e.first.approval.body.review;
    for (const s of [e.replay.after,e.final]) s.reviews = [structuredClone(approved)];
    e.replay.review.body = structuredClone(approved);
  } },
  'observer readiness absent coherently': { check: 'observer_ready', mutate(t,e) {
    for (const s of snapshotsOf(e)) s.observer = [];
  } },
  'runtime identity changed after restart': { check: 'provenance', mutate(t,e) { e.provenance.runtimeAfterB.node = 'unknown'; } },
  ...Object.fromEntries(['SUCCEEDED','STARTED','RUNNING','COMPLETED','UNKNOWN'].map(status => [`contradictory Harness ${status}`, {
    check: 'exclusive_timeline', mutate(t: TimelineRecord[]) { const row = structuredClone(t.find(r => r.category === 'execution')) as any;
      row.data.status = status; t.splice(t.length - 1, 0, row); }
  }])),
};
for (const [name, {check, mutate}] of Object.entries(coherent)) test(`semantic mutation: ${name} [${check}]`, () => {
  const t = recorded(); mutate(t, evidence(t));
  assert.equal(approvedRestartChecks(t)[check], false);
  assert.equal(approvedRestartInvariant(t).passed, false);
});
for (const field of ['ledger','calls','observer','events','reviews','revocations','metadata']) test(`shape rejects coherent length-like ${field}`, () => {
  const t = recorded(); for (const s of snapshotsOf(evidence(t))) s[field] = { length: 0 };
  assert.equal(approvedRestartChecks(t).evidence_shape, false);
  assert.equal(approvedRestartInvariant(t).passed, false);
});
for (const field of ['audit','originalAudit']) test(`shape rejects length-like replay ${field}`, () => {
  const t = recorded(); evidence(t).replay[field] = { length: 0 };
  assert.equal(approvedRestartInvariant(t).passed, false);
});
test('shape rejects absent filesystem provenance coherently', () => {
  const t = recorded(); for (const s of snapshotsOf(evidence(t))) delete s.file.source;
  assert.equal(approvedRestartChecks(t).evidence_shape, false);
});

const isolated: Record<string, (e: any) => void> = {
  zero_ledger(e) {
    const positive = JSON.parse(readFileSync(new URL('../artifacts/human-approval-consumption-survives-restart.rc2-gateway.jsonl', import.meta.url), 'utf8').trim().split('\n')[1]);
    const receipt = positive.data.evidence.rc2_review_restart.first.receipt;
    for (const s of snapshotsOf(e)) s.ledger = [structuredClone(receipt)];
  },
  zero_execution_events(e) {
    const positive = JSON.parse(readFileSync(new URL('../artifacts/human-approval-consumption-survives-restart.rc2-gateway.jsonl', import.meta.url), 'utf8').trim().split('\n')[1]);
    const event = { ...positive.data.evidence.rc2_review_restart.first.audit.find((a: any) => a.event_type === 'tool.execution.started'), sequence: 0 };
    for (const s of snapshotsOf(e)) s.events.unshift(structuredClone(event));
  },
  zero_adapter_calls(e) {
    const call = { type: 'execute', pid: e.a.pid, request: e.first.body };
    for (const s of snapshotsOf(e)) { s.calls = [structuredClone(call)]; s.observer.push(structuredClone(call)); }
  },
  zero_filesystem_effect(e) {
    for (const s of snapshotsOf(e)) s.file = { source: 'harness', exists: true, content: 'unauthorized effect' };
  },
};
for (const [predicate, mutate] of Object.entries(isolated)) test(`isolated mutation kills exactly ${predicate}`, () => {
  const t = recorded(); mutate(evidence(t));
  const checks = approvedRestartChecks(t);
  assert.deepEqual(Object.keys(checks).filter(k => !checks[k]), [predicate]);
  assert.equal(approvedRestartInvariant(t).passed, false);
  // The invariant is the conjunction of these named checks. Removing only the
  // targeted predicate must turn this very same artifact into a false PASS.
  assert.equal(Object.entries(checks).filter(([k]) => k !== predicate).every(([,v]) => v), true);
});

test('provenance sidecar binds the retained artifact without a circular self-hash', () => {
  const artifact = new URL('../artifacts/approved-review-revocation-survives-restart.rc2-gateway.jsonl', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('../artifacts/approved-review-revocation-survives-restart.rc2-gateway.provenance.json', import.meta.url), 'utf8'));
  assert.equal(manifest.artifact.sha256, createHash('sha256').update(readFileSync(artifact)).digest('hex'));
  const { artifact: binding, ...provenance } = manifest;
  assert.deepEqual(provenance, evidence(recorded()).provenance);
});
