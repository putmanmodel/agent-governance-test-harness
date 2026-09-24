import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/harness-cli.ts';

const base = ['run', '--runtime', 'subprocess', '--suite', 'current', '--json'];
async function cli(args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = await runCli(args, s => out.push(s), s => err.push(s));
  return { code, out, err };
}

test('external reference runtime needs no source registration and reports supplied identity', async () => {
  const r = await cli([...base, '--command', process.execPath, '--command-arg', fileURLToPath(new URL('../reference-runtime/runtime.mjs', import.meta.url)), '--capability', 'revocation', '--runtime-id', 'my-runtime']);
  assert.equal(r.code, 0);
  const report = JSON.parse(r.out[0]);
  assert.equal(report.runtimeId, 'my-runtime');
  assert.deepEqual(report.summary, { passed: 1, failed: 0, unsupported: 6 });
});

test('omitting capabilities yields no passed coverage and does not launch a process', async () => {
  const r = await cli([...base, '--command', '/nonexistent/should-not-launch']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out[0]).runtimeId, 'external-subprocess');
  assert.deepEqual(JSON.parse(r.out[0]).summary, { passed: 0, failed: 0, unsupported: 7 });
});

for (const flags of [[], ['--command-arg', 'x'], ['--command', 'node', '--capability', 'bogus'], ['--command', 'node', '--command', 'node'], ['--command', 'node', '--capability'], ['--command', 'node', '--runtime-id', '']]) {
  test(`invalid external options reject before launch: ${JSON.stringify(flags)}`, async () => {
    const r = await cli([...base, ...flags]);
    assert.equal(r.code, 1); assert.equal(r.out.length, 0); assert.ok(r.err[0]);
  });
}

test('external flags on built-in profiles are rejected', async () => {
  const r = await cli(['run', '--runtime', 'subprocess-reference', '--suite', 'current', '--command', 'node']);
  assert.equal(r.code, 1); assert.match(r.err[0], /require --runtime subprocess/);
});

for (const mode of ['success', 'assertion', 'malformed', 'exit']) {
  test(`argv preserved and child reaped after ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'external-cli-'));
    const pidFile = join(dir, 'pid');
    const argument = 'spaces ; $(not-a-shell)';
    const script = `
      const fs=require('node:fs'); fs.writeFileSync(process.argv[1],String(process.pid));
      if(process.argv[2]!==${JSON.stringify(argument)}) process.exit(3);
      let active=false,n=0;
      require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
        const m=JSON.parse(line);
        if('${mode}'==='exit') process.exit(2);
        if('${mode}'==='malformed') { console.log('{bad'); return; }
        const e={protocol_version:'1',id:m.id};
        if(m.op==='inject') { active=m.type==='GRANT'; console.log(JSON.stringify({...e,kind:'ack',applied:true,type:m.type,authority_ref:m.authority_ref})); }
        else { n++; console.log(JSON.stringify({...e,kind:'decision',request_id:m.request.request_id,decision_id:'d'+n,evaluation_id:'e'+n,outcome:active||'${mode}'==='assertion'?'allow':'deny',reason:'fixture',evidence:{}})); }
      });`;
    try {
      const r = await cli([...base, '--command', process.execPath, '--command-arg=-e', '--command-arg', script, '--command-arg', pidFile, '--command-arg', argument, '--capability', 'revocation']);
      assert.equal(r.code, mode === 'success' ? 0 : 1);
      assert.equal(JSON.parse(r.out[0]).results[0].status, mode === 'success' ? 'PASS' : 'FAIL');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), (error: any) => error.code === 'ESRCH');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
