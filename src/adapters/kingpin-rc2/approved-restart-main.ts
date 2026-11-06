import { readFileSync, writeFileSync } from 'node:fs';
import { sha256 } from './approved-restart-provenance.ts';
import { fileURLToPath } from 'node:url';
import { runApprovedRestart } from './approved-restart.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
const result = await runApprovedRestart();
const artifact = fileURLToPath(new URL('../../../artifacts/approved-review-revocation-survives-restart.rc2-gateway.jsonl', import.meta.url));
await writeJsonl(artifact, result.timeline);
const record = result.timeline.find(r => r.category === 'governance');
if (record?.category !== 'governance') throw new Error('Missing qualification evidence');
const e = record.data.evidence.rc2_approved_restart as any;
writeFileSync(artifact.replace(/\.jsonl$/, '.provenance.json'), JSON.stringify({ ...e.provenance,
  artifact: { path: artifact, sha256: sha256(readFileSync(artifact)) } }, null, 2) + '\n');
console.log('Approved review, capability revocation, graceful restart, and original-review refusal. No fresh native decision is invented.');
console.log(formatConsole(result.timeline));
console.log(`${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
