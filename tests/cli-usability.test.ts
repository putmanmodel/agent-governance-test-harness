import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/harness-cli.ts';
import { runSuite, getSuite, formatSuiteReport } from '../src/suite-runner.ts';
import { runApplicable } from '../src/core/applicability.ts';
import { runScenario } from '../src/core/runner.ts';
import { retryAfterRevocation } from '../scenarios/retry-after-revocation.ts';
import { SubprocessAdapter, STDERR_DIAGNOSTIC_LIMIT } from '../src/adapters/subprocess/adapter.ts';
import { SimulatedRuntimeAdapter } from '../src/adapters/simulated-runtime-adapter.ts';

async function cli(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await runCli(args, s => out.push(s), s => err.push(s));
  return { code, out, err };
}
for (const flag of ['--help','-h']) test(`${flag} documents external syntax without launching`, async () => {
  const r = await cli([flag,'run','--runtime','subprocess','--command','/must-not-launch']);
  assert.equal(r.code,0); assert.deepEqual(r.err,[]);
  for (const text of ['--command-arg','--capability','--runtime-id','--artifact-dir','--suite','UNSUPPORTED','Exit 1']) assert.ok(r.out[0].includes(text));
});
test('static discovery lists runtime profiles and all capability names', async () => {
  const runtimes = await cli(['runtimes']); assert.equal(runtimes.code,0);
  for (const id of ['subprocess-reference','kingpin-rc2-governance','kingpin-rc2-gateway','subprocess (external']) assert.ok(runtimes.out[0].includes(id));
  const capabilities = await cli(['capabilities']); assert.equal(capabilities.code,0);
  assert.equal(capabilities.out[0].split('\n').length,7);
  for (const id of ['revocation','human-review','execution-accounting','durable-restart','reconciliation','multi-principal','in-flight-observation']) assert.ok(capabilities.out[0].includes(id+':'));
  assert.equal((await cli(['runtimes','--runtime','subprocess'])).code,1);
});
const failure = { invariantId:'fixture-invariant',name:'Fixture invariant',passed:false,reason:'Retry redispatched',evidence:[2] };
test('applicability preserves existing assertion fields, not native evidence', async () => {
  const r = await runApplicable({id:'fixture',capabilities:[]},{id:'fixture',name:'Fixture',requires:[]},async()=>({passed:false,assertions:[failure]}));
  assert.deepEqual(r.diagnostics,[{invariantId:failure.invariantId,reason:failure.reason}]);
  assert.equal(r.status,'FAIL');
});
test('paired failures and separate artifact paths survive human/JSON reporting without changing suite counts', async () => {
  const dir = await mkdtemp(join(tmpdir(),'suite-artifacts-'));
  try {
    const source = await runScenario(retryAfterRevocation,new SimulatedRuntimeAdapter());
    const report = await runSuite({runtime:{id:'fixture',capabilities:['revocation']},drivers:{
      'retry-after-revocation':async()=>({passed:false,cases:{'after-effect':source,'before-effect':{...source,passed:false,assertions:[failure]}}}),
    }},getSuite('current'),{artifactDir:dir});
    assert.equal(report.reportVersion,'1'); assert.deepEqual(report.summary,{passed:0,failed:1,unsupported:7});
    const r = report.results[0];
    assert.deepEqual(r.diagnostics,[{invariantId:failure.invariantId,reason:failure.reason,case:'before-effect'}]);
    assert.equal(r.artifacts?.length,2);
    for (const artifact of r.artifacts!) {
      assert.ok(artifact.path.startsWith(dir));
      const records = (await readFile(artifact.path,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      assert.deepEqual(records,source.timeline); assert.ok(records.every(r=>r.harness_schema_version==='1'));
    }
    const human = formatSuiteReport(report);
    for (const text of ['case: before-effect','invariant: fixture-invariant','reason: Retry redispatched','artifact:']) assert.ok(human.includes(text));
    const json = JSON.parse(JSON.stringify(report)); assert.equal(json.results[0].diagnostics[0].invariantId,failure.invariantId);
    assert.equal(json.results[0].timeline,undefined);
    const again = await runSuite({runtime:{id:'fixture',capabilities:['revocation']},drivers:{'retry-after-revocation':async()=>source}},getSuite('current'),{artifactDir:dir});
    assert.notEqual(again.results[0].artifacts![0].path,r.artifacts![0].path);
    assert.equal((await readdir(dir)).length,2);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('artifact output remains optional, including drivers without timelines and unsupported runs', async () => {
  const report = await runSuite({runtime:{id:'fixture',capabilities:['revocation']},drivers:{'retry-after-revocation':async()=>({passed:true})}},getSuite('current'));
  assert.equal(report.results[0].artifacts,undefined); assert.equal(report.results[0].diagnostics,undefined);
});
test('external assertion FAIL exposes version, invariant, reason and artifact in real CLI JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(),'cli-failure-'));
  try {
    const script = `let n=0;require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),e={protocol_version:'1',id:m.id};console.log(JSON.stringify(m.op==='inject'?{...e,kind:'ack',applied:true,type:m.type,authority_ref:m.authority_ref}:{...e,kind:'decision',request_id:m.request.request_id,decision_id:'d'+(++n),evaluation_id:'e'+n,outcome:'allow',reason:'broken cached permission',evidence:{}}));});`;
    const r = await cli(['run','--runtime','subprocess','--suite','current','--command',process.execPath,'--command-arg=-e','--command-arg',script,'--capability','revocation','--artifact-dir',dir,'--json']);
    assert.equal(r.code,1); assert.deepEqual(r.err,[]);
    const report=JSON.parse(r.out[0]); assert.equal(report.reportVersion,'1');
    assert.equal(report.results[0].diagnostics[0].invariantId,'revoked-authority-stays-revoked');
    assert.match(report.results[0].diagnostics[0].reason,/fresh denial/);
    assert.ok((await readFile(report.results[0].artifacts[0].path,'utf8')).includes('harness_schema_version'));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
for (const mode of ['timeout','exit','malformed','correlation']) test(`bounded stderr survives ${mode} without entering protocol stdout`, async () => {
  const script = `require('node:readline').createInterface({input:process.stdin}).on('line',()=>{process.stderr.write('DISCARD_PREFIX'+'x'.repeat(9000)+'TAIL_DIAGNOSTIC',()=>{${mode==='exit'?'process.exit(2)':mode==='malformed'?"console.log('{bad')":mode==='correlation'?"console.log(JSON.stringify({protocol_version:'1',id:'wrong',kind:'ack'}))":''}});});`;
  const adapter = new SubprocessAdapter(process.execPath,['-e',script],200);
  await assert.rejects(adapter.inject({type:'GRANT',authorityRef:'authority-1'}));
  await assert.rejects(adapter.close(), (error: Error) => {
    assert.match(error.message,/TAIL_DIAGNOSTIC/); assert.ok(!error.message.includes('DISCARD_PREFIX'));
    const excerpt=error.message.split(`Subprocess stderr (last ${STDERR_DIAGNOSTIC_LIMIT} characters):\n`)[1];
    assert.equal(excerpt.length,STDERR_DIAGNOSTIC_LIMIT); return true;
  });
});
test('PASS does not expose child stderr', async () => {
  const r=await cli(['run','--runtime','subprocess','--suite','current','--command',process.execPath,'--command-arg=-e','--command-arg',"console.error('private diagnostic');import('./reference-runtime/runtime.mjs')",'--capability','revocation','--json']);
  assert.equal(r.code,0); assert.ok(!r.out[0].includes('private diagnostic'));
  assert.deepEqual(JSON.parse(r.out[0]).summary,{passed:1,failed:0,unsupported:7});
});
