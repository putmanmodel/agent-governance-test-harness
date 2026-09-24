import { fileURLToPath } from 'node:url';
import { runUnknownRestart } from './unknown-restart.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
// Separate runs produce separate valid timelines, under one registered family.
for (const crashCase of ['after-effect', 'before-effect'] as const) {
  const result = await runUnknownRestart(crashCase);
  const name = crashCase === 'after-effect' ? 'unknown-execution-survives-restart' : 'unknown-execution-before-effect-survives-restart';
  await writeJsonl(fileURLToPath(new URL(`../../../artifacts/${name}.rc2-gateway.jsonl`, import.meta.url)), result.timeline);
  console.log(`Real SIGKILL ${crashCase}; native reconciliation without re-execution.`);
  console.log(formatConsole(result.timeline));
  console.log(`${result.passed ? 'PASS' : 'FAIL'}: ${crashCase}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
  if (!result.passed) process.exitCode = 1;
}
