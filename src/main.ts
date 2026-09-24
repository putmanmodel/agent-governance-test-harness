import { fileURLToPath } from 'node:url';
import { retryAfterRevocation } from '../scenarios/retry-after-revocation.ts';
import { SimulatedRuntimeAdapter } from './adapters/simulated-runtime-adapter.ts';
import { runScenario } from './core/runner.ts';
import { formatConsole } from './reporters/console-reporter.ts';
import { writeJsonl } from './reporters/jsonl-reporter.ts';
import { loadRc2Adapter } from './adapters/kingpin-rc2/load.ts';

const rc2 = process.argv.includes('--rc2');
const proposal = retryAfterRevocation.events.find(event => event.type === 'PROPOSE');
if (!proposal || !('requestId' in proposal)) throw new Error('Missing scenario proposal');
const adapter = rc2 ? await loadRc2Adapter(proposal.payload.request) : new SimulatedRuntimeAdapter();
const result = await runScenario(retryAfterRevocation, adapter);
await writeJsonl(fileURLToPath(new URL(`../artifacts/retry-after-revocation${rc2 ? '.rc2' : ''}.jsonl`, import.meta.url)), result.timeline);
if (rc2) console.log('Governance: real CDE/Kingpin RC2. Enforcement and execution (including UNKNOWN): harness simulation.');
console.log(formatConsole(result.timeline));
console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
