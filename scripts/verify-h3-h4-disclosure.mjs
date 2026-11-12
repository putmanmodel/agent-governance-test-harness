import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyRotation } from '../src/adapters/kingpin-rc2/h3-memory-check.ts';
import { verifySqliteRotation } from '../src/adapters/kingpin-rc2/h3-sqlite-check.ts';
import { verifyContraction } from '../src/adapters/kingpin-rc2/h4-check.ts';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('evidence/h3-h4-disclosure.json', root)));
const cases = {
  'H3-Memory': ['01', '02'],
  'H3-SQLite': ['01', '02'],
  'H4-SQLite': ['04', '05', '06'],
};
const checks = { 'H3-Memory': verifyRotation, 'H3-SQLite': verifySqliteRotation, 'H4-SQLite': verifyContraction };
assert.equal(manifest.artifacts.length, 14);
for (const collection of ['historical', 'public-release']) {
  for (const [suite, suffixes] of Object.entries(cases)) {
    for (const suffix of suffixes) {
      const id = suite + '-CR-' + suffix;
      const artifact = manifest.artifacts.find(row => row.collection === collection && row.scenario === id);
      assert.ok(artifact, collection + '/' + id);
      const bytes = readFileSync(new URL(artifact.derivative, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.derivativeSHA256);
      const rows = bytes.toString().trimEnd().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(rows.map(row => [row.scenarioId, row.category]), [[id, 'governance'], [id, 'assertion']]);
      assert.equal(rows[1].data.passed, true);
      const evidence = rows[0].data.evidence;
      assert.equal(evidence.runtime.repository.commit, artifact.kingpin);
      assert.equal(evidence.runtime.inventory, artifact.inventory);
      assert.deepEqual(evidence.harness.repository, artifact.harness);
      checks[suite](id, evidence.rotation ?? evidence.sqliteRotation);
      console.log(collection, id, 'PASS');
    }
  }
}
