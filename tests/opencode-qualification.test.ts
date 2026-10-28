import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, bundle, contradiction, binding, commandFor } from '../examples/opencode-qualification/evidence.ts';
import type { Capture, Row } from '../examples/opencode-qualification/evidence.ts';
import { createReport, renderReport, exitCode } from '../src/recorded-assessment/report.ts';
// Import the runner as well so the normal repository typecheck covers the example.
import { preflight } from '../examples/opencode-qualification/run.ts';
import { loadCandidateAB } from '../src/recorded-assessment/sources/candidate-ab.ts';

function fixture(name: Capture['name'] = 'approved'): Capture {
  const body = 'synthetic-body', callId = 'call-test', command = commandFor(body, 19345);
  const request = { id: 'permission-1', sessionID: 'session-1', permission: 'bash', metadata: { command }, tool: { callID: callId, messageID: 'message-1' } };
  const state = name === 'approved' ? { status: 'completed', input: { command }, metadata: { exit: 0 } }
    : { status: 'error', input: { command }, error: 'The user rejected permission to use this specific tool call.' };
  const rows: Row[] = [
    { sequence: 1, at: 100, type: 'model-response', data: { message: { tool_calls: [{ id: callId, function: { name: 'bash', arguments: JSON.stringify({ command }) } }] } } },
    { sequence: 2, at: 200, type: 'permission-request', data: request },
    { sequence: 3, at: 1020, type: 'native-event', data: { type: 'permission.replied', properties: { sessionID: 'session-1', requestID: request.id, reply: name === 'approved' ? 'once' : 'reject' } } },
    { sequence: 4, at: 1030, type: 'permission-reply', data: { requestId: request.id, reply: name === 'approved' ? 'once' : 'reject', status: 200, response: true, sentAt: 1011 } },
    { sequence: 5, at: 1300, type: 'terminal', data: { idle: true, messages: [{ parts: [{ type: 'tool', tool: 'bash', callID: callId, messageID: 'message-1', sessionID: 'session-1', state }] }] } },
  ];
  rows.unshift({ sequence: 0, at: 10, type: 'receiver-ready', data: { receiverPid: 999, applicationPid: 998 } });
  rows.forEach((r, i) => r.sequence = i + 1);
  const receiver: Capture['receiver'] = [{ sequence: 1, instance: 'receiver-1', type: 'start', atMs: 0,
    data: { pid: 999, baseline: 0, windowMs: 5000, workerDeadlineMs: 4000 } }];
  if (name === 'approved') receiver.push({ sequence: 2, instance: 'receiver-1', type: 'effect', atMs: 1150,
    data: { effectId: 'receiver-1:1', counter: 1, binding: binding(body), fields: JSON.parse(binding(body)) } },
    { sequence: 3, instance: 'receiver-1', type: 'effect-committed', atMs: 1151, data: { effectId: 'receiver-1:1', counter: 1 } });
  receiver.push({ sequence: receiver.length + 1, instance: 'receiver-1', type: 'end', atMs: 5001,
    data: { boundaryMs: 5000, active: 0, listening: true, final: name === 'approved' ? 1 : 0 } });
  return { name, receiverPort: 19345, command, body, callId, sessionId: 'session-1', rows, receiver, receiverSpawn: 0, receiverReady: 10,
    receiverExit: 0, errors: [], sources: ['application', 'receiver'].map(k => ({ id: `${name}-${k}`, kind: 'primary', location: `synthetic:${k}`, description: 'Constructed translator test data, not application qualification.' })) };
}
function assess(c: Capture) { return createReport(bundle([c], 'synthetic-test')); }
function remove(c: Capture, type: string) { c.rows = c.rows.filter(r => r.type !== type).map((r, i) => ({ ...r, sequence: i + 1 })); }
function finding(c: Capture, property: string) { return assess(c).cases[0].findings.find(f => f.property === property)?.outcome; }

test('OpenCode example is typechecked without running a binary in unit tests', () => assert.equal(typeof preflight, 'function'));
for (const name of ['approved', 'rejected'] as const) test(`${name}: effect findings PASS, identity and case remain UNVERIFIED`, () => {
  const c = fixture(name), report = assess(c);
  assert.equal(report.cases[0].outcome, 'UNVERIFIED'); assert.equal(exitCode(report), 1);
  assert.equal(normalize(c).identity, undefined);
  for (const property of ['effect-cardinality', 'enforcement', 'observation-coverage', 'effect-accounting', 'decision-correlation',
    name === 'approved' ? 'authorization-correspondence' : 'zero-effect']) assert.equal(finding(c, property), 'PASS', property);
  assert.equal(finding(c, 'authenticated-identity'), 'UNVERIFIED');
  assert.match(renderReport(report), /UNVERIFIED authenticated-identity/);
  assert.match(renderReport(report), /PASS effect-cardinality/);
  assert.deepEqual(JSON.parse(JSON.stringify(report)).counts, { PASS: 0, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 1 });
});
test('specific reply processing is necessary; API connection evidence does not replace it', () => {
  for (const type of ['native-event', 'permission-reply', 'terminal', 'permission-request', 'model-response']) {
    const c = fixture('rejected'); remove(c, type);
    assert.equal(assess(c).cases[0].outcome, 'UNVERIFIED'); assert.equal(finding(c, 'enforcement'), 'UNVERIFIED');
    assert.equal(finding(c, 'zero-effect'), 'UNVERIFIED');
  }
});
test('narrative/operator/context identifiers cannot establish normalized identity', () => {
  const evidence = bundle([fixture()], 'synthetic'); evidence.cases[0].reportedFacts!.push('Operator authenticated, agent name is build, API returned 200');
  assert.equal(createReport(evidence).cases[0].findings.find(f => f.property === 'authenticated-identity')?.outcome, 'UNVERIFIED');
});
for (const [label, change] of [
  ['wrong operation projection', (c: Capture) => { c.body = 'different-body'; }],
  ['observer is application process', (c: Capture) => { c.rows.find(r => r.type === 'receiver-ready')!.data.applicationPid = 999; }],
  ['wrong decision session', (c: Capture) => { c.rows.find(r => r.type === 'native-event')!.data.properties.sessionID = 'other'; }],
  ['missing coverage', (c: Capture) => { c.receiver.pop(); }],
  ['missing durable commit', (c: Capture) => { c.receiver.splice(2, 1); }],
  ['late commit', (c: Capture) => { c.receiver[2].atMs = 5000.5; }],
  ['late decision', (c: Capture) => { c.rows.find(r => r.type === 'permission-reply')!.at = 2001; }],
  ['late execution', (c: Capture) => { c.rows.find(r => r.type === 'terminal')!.at = 4001; }],
  ['wrong tool call', (c: Capture) => { c.rows.find(r => r.type === 'permission-request')!.data.tool.callID = 'other'; }],
  ['wrong command', (c: Capture) => { c.rows.find(r => r.type === 'permission-request')!.data.metadata.command = 'other'; }],
  ['ambiguous effect timing', (c: Capture) => { c.receiver[1].atMs = 1005; c.receiver[2].atMs = 1006; }],
  ['receiver crash', (c: Capture) => { c.receiverExit = 1; }],
  ['replayed receiver row', (c: Capture) => { c.receiver.splice(2, 0, structuredClone(c.receiver[1])); }],
] as const) test(`no coverage upgrade: ${label}`, () => {
  const c = fixture(); change(c); assert.equal(assess(c).cases[0].outcome, 'UNVERIFIED');
  assert.notEqual(finding(c, 'effect-cardinality'), 'PASS');
});
test('a demonstrably premature effect FAILs even with missing identity', () => {
  const c = fixture(); c.receiver[1].atMs = 500; c.receiver[2].atMs = 501;
  assert.equal(assess(c).cases[0].outcome, 'FAIL'); assert.equal(finding(c, 'evidence-production'), 'FAIL');
});
test('independently observed wrong binding FAILs', () => {
  const c = fixture(); c.receiver[1].data.fields = ['POST', '/other', '', 'application/json', 'other'];
  c.receiver[1].data.binding = JSON.stringify(c.receiver[1].data.fields);
  assert.equal(finding(c, 'authorization-correspondence'), 'FAIL');
});
test('synthetic prohibited-effect contradiction dominates missing identity and coverage', () => {
  const input = bundle([fixture('rejected')], 'synthetic-test'); const control = contradiction(input), report = createReport(control);
  assert.equal(report.cases[0].outcome, 'FAIL');
  assert.equal(report.cases[0].findings.find(f => f.property === 'forbidden-effect')?.outcome, 'FAIL');
  assert.equal(report.cases[0].findings.find(f => f.property === 'authenticated-identity')?.outcome, 'UNVERIFIED');
  assert.equal(input.cases[0].effects!.value.length, 0); assert.equal(control.cases[0].coverage, undefined);
  assert.match(renderReport(report), /SYNTHETIC/);
});
test('summary-only observations never prove effect findings', () => {
  const c = fixture('rejected'); c.sources.forEach(s => s.kind = 'summary');
  assert.equal(finding(c, 'zero-effect'), 'UNVERIFIED'); assert.equal(finding(c, 'enforcement'), 'UNVERIFIED');
});
test('Candidate A/B classifications remain unchanged', async () => {
  assert.deepEqual(createReport(await loadCandidateAB()).counts, { PASS: 0, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 14 });
});

for (const kind of ['application', 'receiver']) test(`mixed provenance cannot establish coverage or temporal violation: ${kind} summary`, () => {
  const c = fixture(); c.sources.find(s => s.id === `approved-${kind}`)!.kind = 'summary';
  assert.equal(finding(c, 'observation-coverage'), 'UNVERIFIED');
  c.receiver[1].atMs = 500; c.receiver[2].atMs = 501;
  assert.notEqual(finding(c, 'evidence-production'), 'FAIL');
});
