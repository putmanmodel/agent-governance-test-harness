import { fileURLToPath } from 'node:url';
import { SubprocessAdapter } from './adapter.ts';
import { subprocessReferenceRuntime } from './capabilities.ts';
import { retryAfterRevocation } from '../../../scenarios/retry-after-revocation.ts';
import { currentScenarioRegistrations } from '../../../scenarios/registrations.ts';
import { runScenario } from '../../core/runner.ts';
import { runApplicable, summarizeApplicability } from '../../core/applicability.ts';
import type { RuntimeCapability } from '../../core/applicability.ts';

export async function runSubprocessSuite(requiredCapabilities: readonly RuntimeCapability[] = []) {
  const results = [];
  for (const registration of currentScenarioRegistrations) {
    results.push(await runApplicable(subprocessReferenceRuntime, registration, async () => {
      // A declaration alone cannot silently enable an unimplemented scenario binding.
      if (registration.id !== retryAfterRevocation.id) throw new Error('No subprocess scenario binding');
      const adapter = new SubprocessAdapter(process.execPath, [fileURLToPath(new URL('../../../reference-runtime/runtime.mjs', import.meta.url))]);
      try { return await runScenario(retryAfterRevocation, adapter); }
      finally { await adapter.close(); }
    }, requiredCapabilities));
  }
  return results;
}

export function formatSuite(results: Awaited<ReturnType<typeof runSubprocessSuite>>) {
  const summary = summarizeApplicability(results);
  return [`Runtime: ${subprocessReferenceRuntime.id}`, ...results.map(r =>
    `${r.status.padEnd(12)} ${r.scenarioName}${r.missingCapabilities.length ? ` (missing: ${r.missingCapabilities.join(', ')})` : ''}${r.status === 'FAIL' ? `: ${r.reason}` : ''}`),
  `${summary.passed} passed; ${summary.failed} failed; ${summary.unsupported} unsupported (not passed coverage).`,
  'Governance uses the subprocess; enforcement and execution remain simulated.'].join('\n');
}
