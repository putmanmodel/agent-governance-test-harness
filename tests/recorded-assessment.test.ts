import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { validateEvidence, ValidationError } from '../src/recorded-assessment/evidence.ts';
import type { RecordedEvidence, RecordedCase } from '../src/recorded-assessment/evidence.ts';
import { createReport, renderReport, exitCode } from '../src/recorded-assessment/report.ts';
import { loadCandidateAB } from '../src/recorded-assessment/sources/candidate-ab.ts';
const fixturePath = new URL('./fixtures/recorded-assessment/independent-vocabulary.json', import.meta.url);
const fixture = (): RecordedEvidence => validateEvidence(JSON.parse(readFileSync(fixturePath, 'utf8')));

test('different native vocabulary passes both families without runtime-specific branches', () => {
  const report = createReport(fixture());
  assert.deepEqual(report.counts, { PASS: 2, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 0 });
  assert.equal(exitCode(report), 0);
  assert.equal(report.reportVersion, '2');
  assert.equal(report.assessmentKind, 'recorded-run');
  assert.match(renderReport(report), /not a live runtime validation/);
  assert.match(renderReport(report), /synthetic:observer/);
  assert.match(renderReport(report), /Bounded fixture window/);
  assert.deepEqual(createReport(fixture()), report);
});

const mutations: [string, number, (c: RecordedCase) => void][] = [
  ['effect without authority despite allow enforcement', 0, c => { c.authority!.value.effectAuthorized = false; }],
  ['decision for wrong request', 0, c => { c.authority!.value.requestId = 'r1'; }],
  ['original decision reused', 1, c => { c.authority!.value.decisionId = 'd1'; }],
  ['fresh binding not tied to decision', 1, c => { c.review!.value.freshBinding = 'unrelated'; }],
  ['changed method binding', 0, c => { c.effects!.value[0].binding = 'method-changed'; }],
  ['changed path binding', 0, c => { c.effects!.value[0].binding = 'path-changed'; }],
  ['changed query binding', 0, c => { c.effects!.value[0].binding = 'query-changed'; }],
  ['changed header binding', 0, c => { c.effects!.value[0].binding = 'header-changed'; }],
  ['changed body binding', 0, c => { c.effects!.value[0].binding = 'body-changed'; }],
  ['unrelated effect correlation', 0, c => { c.effects!.value[0].requestId = 'other'; }],
  ['spoofed authority principal', 0, c => { c.identity!.value.authorityPrincipal = 'admin'; }],
  ['old authenticated request reused', 0, c => { c.identity!.value.authenticatedRequestId = 'r1'; }],
  ['effect despite block', 1, c => { c.effects!.value.push({ requestId: 'r2', binding: 'b' }); c.coverage!.value.final++; }],
  ['counter increment with empty journal', 1, c => { c.coverage!.value.final++; }],
  ['erased durable rich state', 1, c => { c.review!.value.durableState = 'DENY'; }],
  ['erased client reason', 1, c => { c.enforcement!.value.reason = 'generic-deny'; }],
  ['native review state mismatch', 1, c => { c.review!.value.nativeState = 'REFUSED'; }],
  ['approval transferred', 1, c => { c.review!.value.freshExecutionAuthorized = true; }],
  ['replay targeted new approval', 1, c => { c.review!.value.attemptedApprovalBinding = 'binding-2'; }],
  ['reused request ID', 1, c => { c.review!.value.freshRequestId = 'r1'; }],
  ['reused binding', 1, c => { c.review!.value.freshBinding = 'binding-1'; }],
  ['wrong approval provenance', 1, c => { c.review!.value.approvalSourceRequestId = 'r2'; }],
  ['declared evidence-production breach', 0, c => { c.evidenceRequirement = { requirement: 'Append evidence before release', violation: { value: 'Observed release before append', sources: ['runtime'] } }; }],
];
for (const [name, index, mutate] of mutations) test(`falsification: ${name}`, () => {
  const input = fixture(); mutate(input.cases[index]);
  assert.equal(createReport(input).cases[index].outcome, 'FAIL');
});
const missing: [string, (c: RecordedCase) => void][] = [
  ['no coverage', c => { delete c.coverage; }],
  ['observer not independent', c => { c.coverage!.value.independent = false; }],
  ['observer availability missing', c => { c.coverage!.value.availableThroughout = false; }],
  ['outside bounded window', c => { c.coverage!.value.actionTime = 100; }],
  ['request outside scope', c => { c.coverage!.value.requestIds = ['other']; }],
  ['no identity observation', c => { delete c.identity; }],
  ['no effect observation', c => { delete c.effects; }],
  ['no review observation', c => { delete c.review; }],
];
for (const [name, mutate] of missing) test(`insufficient evidence: ${name}`, () => {
  const input = fixture(); mutate(input.cases[1]);
  const report = createReport(input);
  assert.equal(report.cases[1].outcome, 'UNVERIFIED');
  assert.equal(exitCode(report), 1);
});

test('no authority decision on blocked fault is preserved; zero effects require observation', () => {
  const input = fixture(); const c = input.cases[1];
  c.family = 'bounded-correspondence'; delete c.review; delete c.authority;
  assert.equal(createReport(input).cases[1].outcome, 'PASS');
  assert.equal(c.authority, undefined);
  delete c.coverage;
  assert.equal(createReport(input).cases[1].outcome, 'UNVERIFIED');
  assert.equal(createReport(input).cases[1].findings.find(f => f.property === 'zero-effect')?.outcome, 'UNVERIFIED');
});
test('missing declared evidence is not automatically a violation', () => {
  const input = fixture(); delete input.cases[0].effects;
  input.cases[0].evidenceRequirement = { requirement: 'Produce independent observations' };
  assert.equal(createReport(input).cases[0].outcome, 'UNVERIFIED');
});
test('known violation dominates missing evidence and claimed unsupported', () => {
  const input = fixture(); const c = input.cases[0];
  c.effects!.value[0].binding = 'wrong'; delete c.coverage;
  c.applicability = { supported: false, reason: 'Opt-out attempt' };
  assert.equal(createReport(input).cases[0].outcome, 'FAIL');
});
test('unsupported is untested coverage, never passed coverage', () => {
  const input = fixture(); input.cases = [input.cases[0]];
  const c = input.cases[0]; c.applicability = { supported: false, reason: 'No operation observation facility' };
  delete c.effects; delete c.coverage;
  assert.equal(createReport(input).cases[0].outcome, 'UNSUPPORTED');
  assert.equal(createReport(input).counts.PASS, 0);
});
test('summary assertions cannot substitute for primary observations', () => {
  const input = fixture(); input.sources.forEach(s => { s.kind = 'summary'; });
  assert.equal(createReport(input).counts.UNVERIFIED, 2);
});
test('A/B native extracts support individual findings without inheriting summary PASS', async () => {
  const evidence = await loadCandidateAB(); const report = createReport(evidence);
  assert.equal(report.cases.length, 14);
  assert.deepEqual(report.counts, { PASS: 0, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 14 });
  const summaries = evidence.sources.filter(s => s.kind === 'summary');
  assert.equal(summaries.length, 2);
  for (const source of summaries) {
    assert.match(source.description, /Derived publication fixture/);
    assert.match(source.description, /Not an unmodified source snapshot/);
  }
  for (const name of ['candidate-a', 'candidate-b']) {
    const text = readFileSync(new URL(`./fixtures/recorded-assessment/${name}.md`, import.meta.url), 'utf8');
    assert.match(text, /Derived publication fixture/);
    assert.match(text, /Original report SHA256: `[a-f0-9]{64}`/);
    assert.doesNotMatch(text, /\/(?:Users|private\/(?:tmp|var))\/|~\/\.local\/state\//);
  }
  assert.equal(report.cases[0].findings.find(f => f.property === 'authorization-correspondence')?.outcome, 'PASS');
  assert.equal(report.cases[13].findings.find(f => f.property === 'fresh-binding-evidence')?.outcome, 'PASS');
  assert.equal(evidence.cases[9].authority, undefined);
  assert.match(renderReport(report), /REQUEST_BINDING_CHANGED/);
  assert.match(renderReport(report), /no authority decision/);
  assert.match(renderReport(report), /human_review/);
  assert.match(renderReport(report), /sha256=/);
});
for (const [name, mutate] of [
  ['unknown field', (v: any) => { v.cases[0].typo = true; }],
  ['wrong type', (v: any) => { v.cases[0].coverage.value.start = 'yesterday'; }],
  ['unknown source', (v: any) => { v.cases[0].effects.sources = ['missing']; }],
  ['duplicate ID', (v: any) => { v.cases[1].id = v.cases[0].id; }],
  ['invalid window', (v: any) => { v.cases[0].coverage.value.end = 0; }],
  ['invalid counter', (v: any) => { v.cases[0].coverage.value.final = -1; }],
] as const) test(`validation error, not governance FAIL: ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => createReport(input), ValidationError);
});
test('CLI reports recorded results and uses distinct validation exit', () => {
  const cli = new URL('../src/recorded-assessment/cli.ts', import.meta.url);
  const invoke = (...args: string[]) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
  const good = invoke(fixturePath.pathname, '--json');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).reportVersion, '2');
  const summary = invoke('--candidate-ab');
  assert.equal(summary.status, 1, summary.stderr);
  assert.match(summary.stdout, /14 unverified/);
  const invalid = invoke('--unknown');
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Assessment input error/);
});

test('uncorrelated effect outside usable coverage is insufficient, not a demonstrated violation', () => {
  const input = fixture(); const c = input.cases[1];
  delete c.coverage; c.effects!.value = [{ requestId: 'unrelated', binding: 'other' }];
  assert.equal(createReport(input).cases[1].outcome, 'UNVERIFIED');
});
test('native decision and durable review terminology may differ', () => {
  const input = fixture(); input.cases[1].authority!.value.nativeOutcome = 'REQUIRES_OPERATOR';
  assert.equal(createReport(input).cases[1].outcome, 'PASS');
});

test('mutated recorded Candidate observations reject actual binding mismatch and approval transfer', async () => {
  const input = await loadCandidateAB();
  input.cases[0].effects!.value[0].binding = 'changed-operation';
  input.cases[13].review!.value.freshExecutionAuthorized = true;
  const report = createReport(input);
  assert.equal(report.cases[0].outcome, 'FAIL');
  assert.equal(report.cases[13].outcome, 'FAIL');
});

test('an unexercised positive-effect boundary is UNVERIFIED, not a governance failure', () => {
  const input = fixture(); input.cases[0].effects!.value = [];
  input.cases[0].coverage!.value.final = 0;
  assert.equal(createReport(input).cases[0].outcome, 'UNVERIFIED');
});

function withSecondarySource(): RecordedEvidence {
  const input = fixture();
  input.sources.push({ id: 'secondary', kind: 'summary', location: 'synthetic:secondary', description: 'Secondary account, not primary observations' });
  return input;
}

for (const effectEvidence of ['secondary-positive', 'secondary-empty', 'absent'] as const) {
  for (const increment of [0, 1]) test(`independent counter: ${effectEvidence}, delta ${increment}`, () => {
    const input = withSecondarySource(); const c = input.cases[1];
    c.coverage!.value.final = increment;
    if (effectEvidence === 'absent') delete c.effects;
    else c.effects = { value: effectEvidence === 'secondary-positive' ? [{ requestId: c.requestId, binding: 'binding-2' }] : [], sources: ['secondary'] };
    const report = createReport(input); const result = report.cases[1];
    assert.equal(result.outcome, increment ? 'FAIL' : 'UNVERIFIED');
    assert.equal(report.counts.UNSUPPORTED, 0);
    assert.equal(result.findings.find(f => f.property === 'forbidden-effect-counter')?.outcome, increment ? 'FAIL' : undefined);
    assert.equal(result.findings.find(f => f.property === 'zero-effect')?.outcome, 'UNVERIFIED');
  });
}

for (const counterEvidence of ['secondary', 'absent'] as const) {
  for (const hasEffect of [false, true]) test(`independent effect list: ${counterEvidence} counter, effect ${hasEffect}`, () => {
    const input = withSecondarySource(); const c = input.cases[1];
    c.effects!.value = hasEffect ? [{ requestId: c.requestId, binding: 'binding-2' }] : [];
    if (counterEvidence === 'absent') delete c.coverage;
    else c.coverage!.sources = ['secondary'];
    const report = createReport(input); const result = report.cases[1];
    assert.equal(result.outcome, hasEffect ? 'FAIL' : 'UNVERIFIED');
    assert.equal(report.counts.UNSUPPORTED, 0);
    assert.equal(result.findings.find(f => f.property === 'forbidden-effect')?.outcome, hasEffect ? 'FAIL' : undefined);
    assert.equal(result.findings.find(f => f.property === 'zero-effect')?.outcome, 'UNVERIFIED');
  });
}

for (const [name, weaken] of [
  ['secondary provenance', (c: RecordedCase) => { c.coverage!.sources = ['secondary']; }],
  ['observer dependence', (c: RecordedCase) => { c.coverage!.value.independent = false; }],
  ['incomplete availability', (c: RecordedCase) => { c.coverage!.value.availableThroughout = false; }],
  ['missing correlation', (c: RecordedCase) => { c.coverage!.value.requestIds = ['unrelated']; }],
  ['outside bounds', (c: RecordedCase) => { c.coverage!.value.actionTime = 100; }],
] as const) test(`counter contradiction requires sufficient evidence: ${name}`, () => {
  const input = withSecondarySource(); const c = input.cases[1];
  c.coverage!.value.final = 1;
  c.effects = { value: [{ requestId: c.requestId, binding: 'binding-2' }], sources: ['secondary'] };
  weaken(c);
  const report = createReport(input);
  assert.equal(report.cases[1].outcome, 'UNVERIFIED');
  assert.equal(report.counts.UNSUPPORTED, 0);
});

for (const missingObservation of ['authority', 'enforcement'] as const) {
  for (const quality of ['secondary', 'absent'] as const) {
    for (const changedState of [false, true]) test(`durable review: ${missingObservation} ${quality}, changed ${changedState}`, () => {
      const input = withSecondarySource(); const c = input.cases[1];
      if (quality === 'absent') delete c[missingObservation];
      else c[missingObservation]!.sources = ['secondary'];
      if (changedState) c.review!.value.durableState = 'ERASED';
      const report = createReport(input); const result = report.cases[1];
      assert.equal(result.outcome, changedState ? 'FAIL' : 'UNVERIFIED');
      assert.equal(report.counts.UNSUPPORTED, 0);
      assert.equal(result.findings.find(f => f.property === 'durable-review-state')?.outcome, changedState ? 'FAIL' : 'PASS');
      assert.equal(result.findings.find(f => f.property === 'rich-state-projection')?.outcome, 'UNVERIFIED');
    });
  }
}

test('primary review reason contradiction does not depend on authority evidence', () => {
  const input = withSecondarySource(); const c = input.cases[1];
  c.authority!.sources = ['secondary'];
  c.enforcement!.value.reason = 'erased-review-reason';
  const result = createReport(input).cases[1];
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.findings.find(f => f.property === 'review-reason-projection')?.outcome, 'FAIL');
  assert.equal(result.findings.find(f => f.property === 'rich-state-projection')?.outcome, 'UNVERIFIED');
});

test('secondary review contradiction cannot establish a violation or a PASS', () => {
  const input = withSecondarySource(); const c = input.cases[1];
  c.review!.sources = ['secondary']; c.review!.value.durableState = 'ERASED';
  const report = createReport(input);
  assert.equal(report.cases[1].outcome, 'UNVERIFIED');
  assert.equal(report.counts.UNSUPPORTED, 0);
});

test('both independently proven effect contradictions retain their primary sources', () => {
  const input = fixture(); const c = input.cases[1];
  c.effects!.value = [{ requestId: c.requestId, binding: 'binding-2' }];
  c.coverage!.value.final = 1;
  const result = createReport(input).cases[1];
  for (const property of ['forbidden-effect', 'forbidden-effect-counter']) {
    const finding = result.findings.find(f => f.property === property);
    assert.equal(finding?.outcome, 'FAIL');
    assert.deepEqual(finding?.sources, ['observer']);
  }
  assert.equal(result.outcome, 'FAIL');
});

test('optional bounded cardinality: one matching effect passes, duplicates fail', () => {
  const input = fixture(); const c = input.cases[0];
  c.contract.expectedEffectCount = 1;
  assert.equal(createReport(input).cases[0].outcome, 'PASS');
  c.effects!.value.push({ ...c.effects!.value[0] }); // Two distinct receiver events with the same operation.
  c.coverage!.value.final = 2;
  assert.equal(createReport(input).cases[0].outcome, 'FAIL');
  assert.equal(createReport(input).cases[0].findings.find(f => f.property === 'effect-cardinality')?.outcome, 'FAIL');
  delete c.coverage;
  c.applicability = { supported: false, reason: 'Cannot hide an observed duplicate' };
  assert.equal(createReport(input).cases[0].outcome, 'FAIL');
});

test('omitted cardinality retains previous matching-effects semantics', () => {
  const input = fixture(); const c = input.cases[0];
  c.effects!.value.push({ ...c.effects!.value[0] }); c.coverage!.value.final = 2;
  const assessed = createReport(input).cases[0];
  assert.equal(assessed.outcome, 'PASS');
  assert.ok(!assessed.findings.some(f => f.property.startsWith('effect-cardinality')));
});

test('optional cardinality: complete bounded zero refutes expected one', () => {
  const input = fixture(); const c = input.cases[0];
  c.contract.expectedEffectCount = 1;
  c.effects!.value = []; c.coverage!.value.final = c.coverage!.value.baseline;
  assert.equal(createReport(input).cases[0].outcome, 'FAIL');
  delete c.coverage;
  assert.equal(createReport(input).cases[0].outcome, 'UNVERIFIED');
});

test('cardinality never upgrades missing, summary-only or incomplete observations', () => {
  for (const alter of [
    (c: RecordedCase) => { delete c.effects; },
    (c: RecordedCase) => { delete c.coverage; },
    (c: RecordedCase) => { c.coverage!.value.availableThroughout = false; },
    (c: RecordedCase) => { c.coverage!.sources = ['secondary']; c.effects!.sources = ['secondary']; },
  ]) {
    const input = withSecondarySource(); const c = input.cases[0];
    c.contract.expectedEffectCount = 1; alter(c);
    assert.equal(createReport(input).cases[0].outcome, 'UNVERIFIED');
  }
});

test('cardinality zero passes only with complete zero-effect evidence', () => {
  const input = fixture(); const c = input.cases[1]; c.contract.expectedEffectCount = 0;
  assert.equal(createReport(input).cases[1].outcome, 'PASS');
  delete c.effects;
  assert.equal(createReport(input).cases[1].outcome, 'UNVERIFIED');
});

test('cardinality validates count and effect-contract consistency', () => {
  for (const count of [-1, 0, 0.5, 2, '1', null]) {
    const input = fixture(); (input.cases[0].contract as any).expectedEffectCount = count;
    assert.throws(() => validateEvidence(input), ValidationError);
  }
  const input = fixture(); input.cases[1].contract.expectedEffectCount = 1;
  assert.throws(() => validateEvidence(input), ValidationError);
});

test('primary bounded counter contradiction survives missing or secondary effect records', () => {
  for (const delta of [0, 2]) {
    const input = withSecondarySource(); const c = input.cases[0];
    c.contract.expectedEffectCount = 1; c.coverage!.value.final = delta;
    c.effects!.sources = ['secondary'];
    assert.equal(createReport(input).cases[0].outcome, 'FAIL');
    delete c.effects;
    assert.equal(createReport(input).cases[0].outcome, 'FAIL');
    c.coverage!.sources = ['secondary'];
    assert.equal(createReport(input).cases[0].outcome, 'UNVERIFIED');
  }
});
