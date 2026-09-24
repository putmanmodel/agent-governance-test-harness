import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { writeJsonl } from './reporters/jsonl-reporter.ts';
import type { ArtifactReference, ScenarioCaseResult } from './scenario-result.ts';
import { currentScenarioRegistrations } from '../scenarios/registrations.ts';
import { runApplicable, summarizeApplicability } from './core/applicability.ts';
import type { RuntimeProfile } from './runtime-registry.ts';

export function getSuite(id: string) {
  if (id !== 'current') throw new Error(`Unknown suite: ${id}`);
  return { id, scenarios: currentScenarioRegistrations };
}

export async function runSuite(profile: RuntimeProfile, suite: ReturnType<typeof getSuite>, options: { artifactDir?: string } = {}) {
  const results = [];
  let outputDirectory: string | undefined;
  for (const registration of suite.scenarios) {
    results.push(await runApplicable(profile.runtime, profile.requirements?.[registration.id] ?? registration, async () => {
      const driver = profile.drivers[registration.id];
      if (!driver) throw new Error(`Missing scenario driver: ${registration.id}`);
      const result = await driver();
      if (!options.artifactDir) return result;
      const artifacts: ArtifactReference[] = [...(result.artifacts ?? [])];
      const save = async (value: ScenarioCaseResult, label?: string) => {
        if (!value.timeline) return;
        if (!outputDirectory) {
          const base = resolve(options.artifactDir!);
          await mkdir(base, { recursive: true });
          outputDirectory = await mkdtemp(join(base, 'run-'));
        }
        const name = encodeURIComponent(registration.id) + (label === undefined ? '' : '.' + encodeURIComponent(label));
        const path = join(outputDirectory, `${name}.jsonl`);
        await writeJsonl(path, value.timeline);
        artifacts.push({ path, ...(label === undefined ? {} : { case: label }) });
      };
      await save(result);
      for (const [label, value] of Object.entries(result.cases ?? {})) await save(value, label);
      return { ...result, artifacts };
    }));
  }
  return { reportVersion: '1' as const, runtimeId: profile.runtime.id, suiteId: suite.id, results, summary: summarizeApplicability(results) };
}
export type SuiteReport = Awaited<ReturnType<typeof runSuite>>;
export function suiteExitCode(report: SuiteReport): number { return report.summary.failed ? 1 : 0; }
export function formatSuiteReport(report: SuiteReport): string {
  return [`Runtime: ${report.runtimeId}`, `Suite: ${report.suiteId}`, '', ...report.results.map(r =>
    `${r.status.padEnd(12)} ${r.scenarioName}${r.missingCapabilities.length ? `\n             missing: ${r.missingCapabilities.join(', ')}` : ''}${r.status === 'FAIL' ? `\n             ${r.reason}` : ''}${(r.diagnostics ?? []).map(d => `\n             ${d.case ? `case: ${d.case}; ` : ''}invariant: ${d.invariantId}\n             reason: ${d.reason}`).join('')}${(r.artifacts ?? []).map(a => `\n             ${a.case ? `case: ${a.case}; ` : ''}artifact: ${a.path}`).join('')}`), '',
  `${report.summary.passed} passed; ${report.summary.failed} failed; ${report.summary.unsupported} unsupported (not passed coverage).`].join('\n');
}
