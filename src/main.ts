import { fileURLToPath } from 'node:url';
import { retryAfterRevocation } from '../scenarios/retry-after-revocation.ts';
import { SimulatedRuntimeAdapter } from './adapters/simulated-runtime-adapter.ts';
import { runScenario } from './core/runner.ts';
import { formatConsole } from './reporters/console-reporter.ts';
import { writeJsonl } from './reporters/jsonl-reporter.ts';
import { loadRc2Adapter } from './adapters/kingpin-rc2/load.ts';
import { runGatewayScenario } from './adapters/kingpin-rc2/gateway-scenario.ts';

const rc2 = process.argv.includes('--rc2');
const gateway = process.argv.includes('--rc2-gateway');
const proposal = retryAfterRevocation.events.find(event => event.type === 'PROPOSE');
if (!proposal || !('requestId' in proposal)) throw new Error('Missing scenario proposal');
const result = gateway ? await runGatewayScenario() : await runScenario(retryAfterRevocation,
  rc2 ? await loadRc2Adapter(proposal.payload.request) : new SimulatedRuntimeAdapter());
await writeJsonl(fileURLToPath(new URL(`../artifacts/retry-after-revocation${gateway ? '.rc2-gateway' : rc2 ? '.rc2' : ''}.jsonl`, import.meta.url)), result.timeline);
if (gateway) console.log('Real RC2 CDE, Kingpin, HTTP Gateway and sandbox execution. Harness injects a receipt-transaction failure; UNKNOWN and reconciliation are native RC2 observations. Temporary files cleaned up.');
if (rc2) console.log('Governance: real CDE/Kingpin RC2. Enforcement and execution (including UNKNOWN): harness simulation.');
console.log(formatConsole(result.timeline));
console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
