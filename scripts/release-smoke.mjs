import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'governance-smoke-'));
function cli(args) {
  const result = spawnSync(process.execPath, ['src/harness-main.ts', ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    // Deliberately invalid: portable commands must not need any RC2 installation.
    env: { ...process.env, RC2_ROOT: join(temporary, 'no-rc2-checkout') },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
function checkReport(report, runtimeId) {
  assert.equal(report.reportVersion, '1');
  assert.equal(report.runtimeId, runtimeId);
  assert.equal(report.suiteId, 'current');
  assert.deepEqual(report.summary, { passed: 1, failed: 0, unsupported: 7 });
  assert.equal(report.results.length, 8);
  assert.equal(report.results[0].scenarioId, 'retry-after-revocation');
  assert.equal(report.results[0].status, 'PASS');
  assert.ok(report.results.slice(1).every(r => r.status === 'UNSUPPORTED' && r.missingCapabilities.length));
}
try {
  for (const flag of ['--help', '-h']) assert.match(cli([flag]), /--command-arg/);
  assert.match(cli(['runtimes']), /subprocess-reference/);
  assert.match(cli(['capabilities']), /durable-restart/);
  console.log('PASS help and static discovery (RC2 unavailable)');
  const base = ['run', '--suite', 'current'];
  assert.match(cli([...base, '--runtime', 'subprocess-reference']), /1 passed; 0 failed; 7 unsupported/);
  checkReport(JSON.parse(cli([...base, '--runtime', 'subprocess-reference', '--json'])), 'subprocess-reference');
  console.log('PASS subprocess-reference: 1 PASS / 7 UNSUPPORTED; report version 1');
  const report = JSON.parse(cli([...base, '--runtime', 'subprocess', '--command', 'python3',
    '--command-arg', 'examples/python-governance-runtime.py', '--capability', 'revocation',
    '--runtime-id', 'python-example', '--json', '--artifact-dir', temporary]));
  checkReport(report, 'python-example');
  const timeline = readFileSync(report.results[0].artifacts[0].path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(timeline.every(r => r.harness_schema_version === '1'));
  const decisions = timeline.filter(r => r.category === 'governance').map(r => r.data.evidence.subprocess.native);
  assert.deepEqual(decisions.map(d => d.outcome), ['allow', 'deny']);
  assert.ok(decisions.every(d => d.protocol_version === '1'));
  assert.notEqual(decisions[0].evaluation_id, decisions[1].evaluation_id);
  assert.notEqual(decisions[0].decision_id, decisions[1].decision_id);
  const controls = timeline.filter(r => r.category === 'governance').at(-1).data.evidence.subprocess.controls;
  assert.deepEqual(controls.map(c => [c.type, c.applied]), [['GRANT', true], ['REVOKE', true]]);
  console.log('PASS Python external CLI: 1 PASS / 7 UNSUPPORTED; protocol/report/timeline versions 1');
} finally { rmSync(temporary, { recursive: true, force: true }); }
