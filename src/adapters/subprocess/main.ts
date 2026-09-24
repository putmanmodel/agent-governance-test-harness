import { fileURLToPath } from 'node:url';
import { SubprocessAdapter } from './adapter.ts';
import { retryAfterRevocation } from '../../../scenarios/retry-after-revocation.ts';
import { runScenario } from '../../core/runner.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';

const adapter = new SubprocessAdapter(process.execPath, [fileURLToPath(new URL('../../../reference-runtime/runtime.mjs', import.meta.url))]);
try {
  const result = await runScenario(retryAfterRevocation, adapter);
  await writeJsonl(fileURLToPath(new URL('../../../artifacts/retry-after-revocation.subprocess.jsonl', import.meta.url)), result.timeline);
  console.log('Portable governance testing: independent subprocess runtime. Enforcement and execution are simulated; real side-effect containment is not tested.');
  console.log(formatConsole(result.timeline));
  console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
  if (!result.passed) process.exitCode = 1;
} finally { await adapter.close(); }
