import { fileURLToPath } from 'node:url';
import { runHumanApprovalReplay } from './review.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';

const result = await runHumanApprovalReplay();
await writeJsonl(fileURLToPath(new URL('../../../artifacts/human-approval-replay.rc2-gateway.jsonl', import.meta.url)), result.timeline);
console.log('Real RC2 human review, reviewer approval, one-use consumption, Gateway and sandbox execution. Fresh evaluation plus attempted old-approval reuse.');
console.log(formatConsole(result.timeline));
console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
