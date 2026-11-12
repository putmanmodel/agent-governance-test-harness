import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { verifyRotationTarget } from '../src/adapters/kingpin-rc2/h3-memory.ts';

const artifact = new URL('../evidence/h3-memory/H3-Memory-CR-01.jsonl', import.meta.url);
const recorded = JSON.parse(readFileSync(artifact, 'utf8').split('\n')[0]).data.evidence.runtime;
const publicHead = 'eb323c17938c828372bef5faad82e1343efad911';
const publicInventory = '4e503cfc769f098c727c373801655f706d605e8293c01220fdb4798e4af6de96';
const qualifiedDiff = 'gateway_node/execution.test.js\ntests/fixtures/credential_rotation_process.mjs\n';

function fixture(t: TestContext, isRelease = false) {
  const runtime: Parameters<typeof verifyRotationTarget>[0] = structuredClone(recorded);
  runtime.root = mkdtempSync(join(tmpdir(), 'rotation-guard-'));
  t.after(() => rmSync(runtime.root, { recursive: true, force: true }));
  mkdirSync(join(runtime.root, 'kingpin'));
  const manifest = join(runtime.root, 'kingpin/package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'kingpin-runtime', version: '0.1.0-rc.4' }));
  if (isRelease) {
    runtime.repository.commit = publicHead;
    // SHA-256 of the public release blob; this fixture does not represent an installed checkout.
    runtime.files['gateway_node/execution.test.js'] = '29d65c944af6f0115777f3400d4c466482237c9ba13f93a5f0e277f11bdc7602';
  }
  const verify = (diff = isRelease ? '' : qualifiedDiff) => verifyRotationTarget(runtime, diff);
  return { runtime, manifest, verify };
}

for (const isRelease of [false, true]) {
  const label = isRelease ? 'public release' : 'qualification';
  test(label + ' accepts its own revision, diff and full inventory', t => {
    const { verify } = fixture(t, isRelease);
    const result = verify();
    assert.equal(result.repository.commit, isRelease ? publicHead : recorded.repository.commit);
    assert.equal(result.inventory, isRelease ? publicInventory : recorded.inventory);
  });
  test(label + ' rejects the other inventory with its own expected diff', t => {
    const { runtime, verify } = fixture(t, isRelease);
    const other = fixture(t, !isRelease);
    runtime.files = other.runtime.files;
    assert.throws(() => verify(), /inventory mismatch/);
  });
  test(label + ' rejects the other diff with its own inventory', t => {
    assert.throws(() => fixture(t, isRelease).verify(isRelease ? qualifiedDiff : ''), /diff mismatch/);
  });
}

test('unknown revision with matching files', t => {
  const { runtime, verify } = fixture(t);
  runtime.repository.commit = 'f'.repeat(40);
  assert.throws(() => verify(), /Unknown Kingpin target revision/);
});
test('dirty tracked source', t => {
  const { runtime, verify } = fixture(t);
  runtime.repository.dirty = true;
  runtime.repository.changedFiles = [' M kingpin/index.js'];
  assert.throws(() => verify(), /Dirty Kingpin checkout/);
});
for (const [field, value] of [['name', 'other'], ['version', '0.1.0-rc.3']]) {
  test('incorrect package ' + field, t => {
    const { manifest, verify } = fixture(t);
    writeFileSync(manifest, JSON.stringify({ name: 'kingpin-runtime', version: '0.1.0-rc.4', [field]: value }));
    assert.throws(() => verify(), new RegExp('package ' + field + ' mismatch'));
  });
}
for (const path of ['kingpin/index.js', 'gateway_node/node_modules/accepts/index.js']) {
  test('altered inventoried hash for ' + path, t => {
    const { runtime, verify } = fixture(t);
    assert.match(runtime.files[path], /^[0-9a-f]{64}$/);
    runtime.files[path] = '0'.repeat(64);
    assert.throws(() => verify(), /inventory mismatch/);
  });
}
test('missing inventoried source', t => {
  const { runtime, verify } = fixture(t);
  delete runtime.files['kingpin/index.js'];
  assert.throws(() => verify(), /inventory mismatch/);
});
test('unreadable manifest path', t => {
  const { manifest, verify } = fixture(t);
  rmSync(manifest);
  mkdirSync(manifest);
  assert.throws(() => verify(), { code: 'EISDIR' });
});
test('malformed manifest', t => {
  const { manifest, verify } = fixture(t);
  writeFileSync(manifest, '{');
  assert.throws(() => verify(), SyntaxError);
});
test('blank diff line is not an empty release diff', t => {
  assert.throws(() => fixture(t, true).verify('\n'), /diff mismatch/);
});
