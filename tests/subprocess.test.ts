import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SubprocessAdapter } from '../src/adapters/subprocess/adapter.ts';
import { retryAfterRevocation } from '../scenarios/retry-after-revocation.ts';
import { runScenario } from '../src/core/runner.ts';

const proposal = retryAfterRevocation.events.find(e => e.type === 'PROPOSE')!;
if (!('requestId' in proposal)) throw new Error('Missing proposal');
const request = proposal.payload.request;
const reference = () => new SubprocessAdapter(process.execPath, [fileURLToPath(new URL('../reference-runtime/runtime.mjs', import.meta.url))]);
const fixture = (code: string) => new SubprocessAdapter(process.execPath, ['--input-type=module', '-e',
  `import {createInterface} from 'node:readline'; let count=0; for await(const line of createInterface({input:process.stdin})) { const m=JSON.parse(line); ${code} }`]);
const ack = "{protocol_version:'1',id:m.id,kind:'ack',applied:true,type:m.type,authority_ref:m.authority_ref}";
const decision = "{protocol_version:'1',id:m.id,kind:'decision',request_id:m.request.request_id,decision_id:'d-'+(++count),evaluation_id:'e-'+count,outcome:'allow',reason:'fixture',evidence:{native:true}}";

// Close errors are expected only in protocol-rejection tests.
async function rejectFixture(adapter: SubprocessAdapter, operation: () => Promise<unknown>, pattern: RegExp) {
  try { await assert.rejects(operation, pattern); }
  finally { await adapter.close().catch(() => {}); }
}

test('reference subprocess passes unchanged retry invariant with correlated controls, fresh decisions and preserved native evidence', async () => {
  const adapter = reference();
  try {
    const result = await runScenario(retryAfterRevocation, adapter);
    assert.equal(result.passed, true);
    const decisions = result.timeline.filter(r => r.category === 'governance').map(r => r.data);
    assert.deepEqual(decisions.map(d => d.result), ['ALLOW', 'DENY']);
    assert.notEqual(decisions[0].decisionId, decisions[1].decisionId);
    const native = decisions[1].evidence.subprocess as any;
    assert.equal(native.native.outcome, 'deny');
    assert.equal(native.native.request_id, 'request-2');
    assert.equal(native.native.evaluation_id, 'reference-evaluation-2');
    assert.equal(native.native.evidence.authority_valid, false);
    assert.equal(native.native.evidence.provenance.retry_of, 'request-1');
    assert.deepEqual(native.controls.map((c: any) => [c.id, c.type, c.applied]), [['message-1', 'GRANT', true], ['message-3', 'REVOKE', true]]);
  } finally { await adapter.close(); }
});

test('broken external runtime reviving historical authority fails the existing invariant', async () => {
  const adapter = fixture(`if(m.op==='inject') { globalThis.active=m.type==='GRANT'; console.log(JSON.stringify(${ack})); } else { const d=${decision}; d.outcome=globalThis.active || m.request.provenance.retry_of ? 'allow' : 'deny'; console.log(JSON.stringify(d)); }`);
  try { assert.equal((await runScenario(retryAfterRevocation, adapter)).passed, false); }
  finally { await adapter.close(); }
});

for (const [name, code, control, pattern] of [
  ['malformed JSON', "console.log('{bad');", true, /JSON|property/i],
  ['unknown response', "console.log(JSON.stringify({protocol_version:'1',id:m.id,kind:'surprise'}));", true, /unknown protocol/],
  ['mismatched control ID', `console.log(JSON.stringify({...${ack},id:'wrong'}));`, true, /correlation/],
  ['unapplied control', `console.log(JSON.stringify({...${ack},applied:false}));`, true, /acknowledgement/],
  ['wrong control target', `console.log(JSON.stringify({...${ack},authority_ref:'other'}));`, true, /acknowledgement/],
  ['mismatched submission ID', `console.log(JSON.stringify({...${decision},id:'wrong'}));`, false, /correlation/],
  ['wrong request ID', `console.log(JSON.stringify({...${decision},request_id:'wrong'}));`, false, /decision/],
  ['unsupported outcome', `console.log(JSON.stringify({...${decision},outcome:'maybe'}));`, false, /unsupported/],
  ['missing decision ID', `console.log(JSON.stringify({...${decision},decision_id:''}));`, false, /decision/],
  ['premature exit', "console.error('fixture died'); process.exit(2);", false, /exited prematurely/],
] as const) {
  test(`subprocess rejects ${name}`, async () => {
    const adapter = fixture(code);
    await rejectFixture(adapter, () => control ? adapter.inject({ type: 'GRANT', authorityRef: 'authority-1' }) : adapter.submit(request), pattern);
  });
}

test('subprocess rejects repeated native evaluation/decision identities', async () => {
  const adapter = fixture(`count=0; console.log(JSON.stringify(${decision}));`);
  try {
    await adapter.submit(request);
    await assert.rejects(() => adapter.submit({ ...request, requestId: 'request-2' }), /stale/);
  } finally { await adapter.close().catch(() => {}); }
});

test('stdout correlation supports out-of-order responses; stderr is separate', async () => {
  const adapter = fixture(`console.error('diagnostic'); const d=${decision}; setTimeout(()=>console.log(JSON.stringify(d)),m.request.request_id==='request-1'?40:0);`);
  try {
    const [first, second] = await Promise.all([adapter.submit(request), adapter.submit({ ...request, requestId: 'request-2' })]);
    assert.equal(first.requestId, 'request-1'); assert.equal(second.requestId, 'request-2');
    assert.match(adapter.stderr, /diagnostic/);
  } finally { await adapter.close(); }
});

test('runner waits for control acknowledgement before submission', async () => {
  const adapter = fixture(`
    if(m.op==='inject') { globalThis.pending=true; setTimeout(()=>{ globalThis.pending=false; console.log(JSON.stringify(${ack})); },20); }
    else { if(globalThis.pending) { process.exit(3); } console.log(JSON.stringify(${decision})); }
  `);
  try {
    const result = await runScenario(retryAfterRevocation, adapter);
    assert.equal(result.timeline.filter(r => r.category === 'governance').length, 2);
  } finally { await adapter.close(); }
});

test('unresponsive subprocess is terminated after bounded response timeout', async () => {
  const adapter = new SubprocessAdapter(process.execPath, ['-e', 'process.stdin.resume();'], 100);
  await rejectFixture(adapter, () => adapter.submit(request), /timeout/);
});
