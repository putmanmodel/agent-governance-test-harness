import { fileURLToPath } from 'node:url';
import { runDelegatedHandoff } from './handoff.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';

const result = await runDelegatedHandoff();
await writeJsonl(fileURLToPath(new URL('../../../artifacts/delegated-handoff.rc2-gateway.jsonl', import.meta.url)), result.timeline);
console.log('Task handoff: agent-a → agent-b. Separate authenticated principals and fresh CDE/Kingpin evaluation; real Gateway and bounded execution.');
console.log(formatConsole(result.timeline));
console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
