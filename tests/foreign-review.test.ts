import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bindingHash } from '../src/adapters/kingpin-rc2/approved-restart-binding.ts';
import { scenarioId, verifyForeignReview } from '../src/adapters/kingpin-rc2/foreign-review-check.ts';

const path = new URL('../artifacts/' + scenarioId + '.rc2-gateway.jsonl', import.meta.url);
const retained = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]).data.evidence.foreignReview;
test('retained native ingress evidence passes', () => verifyForeignReview(retained));
type Mutation = [string, RegExp, (e: typeof retained) => void];
const mutations: Mutation[] = [
  ['original envelope omits the reviewed write', /invalid original review envelope for fs.write/, e => {
    const envelopes = [e.proposal.response.body.authority_decision.capability_envelope,
      ...[e.pending, e.before, e.after, e.approval.response.body.review].map(r => r.original_envelope),
      ...[...e.originalAudit, ...e.originalAuditAfter].map(r => r.envelope).filter(Boolean)];
    for (const envelope of envelopes) envelope.tools = envelope.tools.filter((tool: string) => tool !== 'fs.write');
  }],
  ['original HUMAN REVIEW reasons coherently replaced', /invalid original HUMAN REVIEW trigger/, e => {
    const codes = ['REVIEWER_DENIED'];
    e.proposal.response.body.authority_decision.reason_codes = codes;
    for (const r of [e.pending, e.before, e.after, e.approval.response.body.review]) r.original_reason_codes = codes;
    for (const r of [...e.originalAudit, ...e.originalAuditAfter]) if (r.outcome === 'human_review') r.reason_codes = codes;
  }],
  ['enforcement hold for a different tool and decision', /enforcement hold tool and decision/, e => {
    const foreignDecision = crypto.randomUUID();
    for (const rows of [e.originalAudit, e.originalAuditAfter]) {
      const hold = rows.find((r: any) => r.event_type === 'tool.enforcement.review');
      Object.assign(hold, { tool_id: 'fs.delete', decision_id: foreignDecision });
    }
  }],
  ['invalid credential / 401', /native ingress refusal/, e => {
    e.attempt.response.status = 401; e.attempt.response.body = { error: 'Authentication required' };
    Object.assign(e.attemptAudit[0], { principal_id: null, reason_codes: ['AUTHENTICATION_REQUIRED'] });
  }],
  ['shared principal', /distinct resolver principals/, e => { e.attempt.transport.principal = e.proposal.transport.principal; }],
  ['forged requester labels with unchanged resolver', /original review identity and trigger/, e => {
    for (const r of [e.pending, e.before, e.after, e.approval.response.body.review]) r.principal_id = 'alternate';
    for (const r of [...e.originalAudit, ...e.originalAuditAfter]) r.principal_id = 'alternate';
  }],
  ['coherent B label substitution', /resolver mapping/, e => {
    e.attemptAudit[0].principal_id = e.attempt.transport.principal.principal_id = 'alternate';
  }],
  ['B body substitution', /unchanged serialized body/, e => { e.attempt.transport.serialized += ' '; }],
  ['coherent operation substitution', /fixed operation/, e => {
    const body = JSON.parse(e.proposal.transport.serialized); body.args.path = 'alternate';
    e.proposal.transport.serialized = e.attempt.transport.serialized = JSON.stringify(body);
  }],
  ['wrong review', /original review URL/, e => { e.attempt.transport.path = '/reviews/other/execute'; }],
  ['missing request ID', /X-Request-ID/, e => { e.attempt.response.requestId = ''; }],
  ['wrong request ID', /rejection request correlation/, e => { e.attempt.response.requestId = crypto.randomUUID(); }],
  ['foreign audit request', /rejection request correlation/, e => { e.attemptAudit[0].request_id = crypto.randomUUID(); }],
  ['403 without audit', /exactly one attempt event/, e => { e.attemptAudit = []; }],
  ['normalized DENY', /native rejection event/, e => { e.attemptAudit[0].event_type = 'DENY'; }],
  ['extra B decision', /exactly one attempt event/, e => {
    e.attemptAudit.push({ ...e.attemptAudit[0], event_type: 'authority.decision', outcome: 'deny' });
  }],
  ['missing runtime permission', /trusted runtime permissions/, e => {
    e.attempt.transport.principal.permissions = ['runtime.use_lease'];
  }],
  ['pending review already consumed', /pending review consumed_at/, e => { e.pending.consumed_at = e.before.resolved_at; }],
  ['coherent approved origin substitution', /immutable original outcome/, e => {
    for (const r of [e.approval.response.body.review, e.before, e.after]) r.original_outcome = 'allow';
  }],
  ['execution ID on held response', /unexpected execution ID or receipt/, e => {
    e.proposal.response.body.execution_id = crypto.randomUUID();
  }],
  ['unexpected approval receipt', /unexpected execution ID or receipt/, e => { e.approval.response.body.receipt = {}; }],
  ['coherent native context substitution', /derived review context/, e => {
    for (const r of [e.pending, e.before, e.after, e.approval.response.body.review]) r.context.session_id = 'elsewhere';
  }],
  ['coherent binding substitution', /fixed native binding/, e => {
    for (const r of [e.pending, e.before, e.after, e.approval.response.body.review]) {
      r.binding.session_id = 'elsewhere'; r.binding_hash = bindingHash(r.binding);
    }
  }],
  ['review requested after rejection', /native causal sequence/, e => {
    for (const rows of [e.originalAudit, e.originalAuditAfter]) rows[4].sequence = e.attemptAudit[0].sequence + 1;
  }],
  ['duplicate event identity', /duplicate native event identity/, e => {
    for (const rows of [e.originalAudit, e.originalAuditAfter]) rows[1].event_id = rows[0].event_id;
  }],
  ['duplicate sequence', /duplicate native sequence/, e => {
    for (const rows of [e.originalAudit, e.originalAuditAfter]) rows[1].sequence = rows[0].sequence;
  }],
  ['contradictory duplicate ancillary event', /native event outcome/, e => {
    for (const rows of [e.originalAudit, e.originalAuditAfter]) rows.push({ ...rows[0], outcome: 'deny' });
  }],
  ['reordered event types with monotonic sequences', /native causal event order/, e => {
    for (const rows of [e.originalAudit, e.originalAuditAfter]) {
      const decision = rows[3], requested = rows[4];
      [decision.sequence, requested.sequence] = [requested.sequence, decision.sequence];
      [rows[3], rows[4]] = [requested, decision];
    }
  }],
  ['pre-attempt sample reused as final', /HTTP and observation collection order/, e => { e.final = structuredClone(e.initial); }],
  ...['consumed', 'invalidated'].map((status): Mutation => ['review ' + status, /unchanged approved review/,
    e => { e.after.status = status; }]),
  ['malformed audit', /attempt audit array/, e => { e.attemptAudit = {}; }],
  ['malformed ledger', /full ledger array/, e => { e.approved.ledger = {}; }],
  ['uninitialized observer', /execute observer readiness/, e => { e.initial.observer.ready = false; }],
  ['coherent adapter invocation', /zero adapter calls/, e => {
    e.approved.observer.calls = e.final.observer.calls = [JSON.parse(e.proposal.transport.serialized)];
  }],
  ['coherent ledger growth', /empty full ledger/, e => {
    e.approved.ledger = e.final.ledger = [{ request_id: e.proposal.response.requestId, review_id: e.before.review_id }];
  }],
  ['coherent file effect', /bounded sandbox contents/, e => {
    e.approved.directory = e.final.directory = ['effect.txt', 'seed.txt'];
  }],
];
for (const [name, predicate, mutate] of mutations) {
  test('rejects ' + name, () => {
    const evidence = structuredClone(retained);
    mutate(evidence);
    assert.throws(() => verifyForeignReview(evidence), predicate);
  });
}
