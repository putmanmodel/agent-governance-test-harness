import { fileURLToPath } from 'node:url';
import { runInFlightRevocation } from './in-flight.ts';
import type { FlightEvidence } from './in-flight-assertion.ts';
import { formatConsole } from '../../reporters/console-reporter.ts';
import { writeJsonl } from '../../reporters/jsonl-reporter.ts';

const result = await runInFlightRevocation();
await writeJsonl(fileURLToPath(new URL('../../../artifacts/in-flight-revocation.rc2-gateway.jsonl', import.meta.url)), result.timeline);
console.log('Real RC2 execution held before its bounded write. Cancellation unsupported; revocation acknowledgement ordering is recorded below.');
console.log(formatConsole(result.timeline));
const record = result.timeline.find(r => r.category === 'governance' && r.data.requestId === 'in-flight-later');
if (record?.category === 'governance') {
  const evidence = record.data.evidence.rc2_in_flight as FlightEvidence;
  console.log('\nHarness observation order (native causal order is retained separately in SQLite audit evidence):');
  console.log(evidence.trace.map(r => `${r.sequence}: ${r.event} (+${r.elapsedMs.toFixed(1)} ms)`).join('\n'));
}
console.log(`\n${result.passed ? 'PASS' : 'FAIL'}: ${result.assertions.filter(a => a.passed).length}/${result.assertions.length} invariants passed.`);
if (!result.passed) process.exitCode = 1;
