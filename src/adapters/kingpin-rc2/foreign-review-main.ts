import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';
import { sha256 } from './approved-restart-provenance.ts';
import { scenarioId } from './foreign-review-check.ts';
import { runForeignReview } from './foreign-review.ts';

const result = await runForeignReview();
const path = fileURLToPath(new URL('../../../artifacts/' + scenarioId + '.rc2-gateway.jsonl', import.meta.url));
await writeJsonl(path, result.timeline);
const hash = sha256(readFileSync(path));
writeFileSync(path + '.sha256', hash + '  ' + path.split('/').at(-1) + '\n');
console.log(result.assertions, hash);
if (!result.passed) process.exitCode = 1;
