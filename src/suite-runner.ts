import { currentScenarioRegistrations } from '../scenarios/registrations.ts';
import { runApplicable, summarizeApplicability } from './core/applicability.ts';
import type { RuntimeProfile } from './runtime-registry.ts';

export function getSuite(id: string) {
  if (id !== 'current') throw new Error(`Unknown suite: ${id}`);
  return { id, scenarios: currentScenarioRegistrations };
}

export async function runSuite(profile: RuntimeProfile, suite: ReturnType<typeof getSuite>) {
  const results = [];
  for (const registration of suite.scenarios) {
    results.push(await runApplicable(profile.runtime, profile.requirements?.[registration.id] ?? registration, async () => {
      const driver = profile.drivers[registration.id];
      if (!driver) throw new Error(`Missing scenario driver: ${registration.id}`);
      return driver();
    }));
  }
  return { runtimeId: profile.runtime.id, suiteId: suite.id, results, summary: summarizeApplicability(results) };
}
export type SuiteReport = Awaited<ReturnType<typeof runSuite>>;
export function suiteExitCode(report: SuiteReport): number { return report.summary.failed ? 1 : 0; }
export function formatSuiteReport(report: SuiteReport): string {
  return [`Runtime: ${report.runtimeId}`, `Suite: ${report.suiteId}`, '', ...report.results.map(r =>
    `${r.status.padEnd(12)} ${r.scenarioName}${r.missingCapabilities.length ? `\n             missing: ${r.missingCapabilities.join(', ')}` : ''}${r.status === 'FAIL' ? `\n             ${r.reason}` : ''}`), '',
  `${report.summary.passed} passed; ${report.summary.failed} failed; ${report.summary.unsupported} unsupported (not passed coverage).`].join('\n');
}
