import { assess } from './assertions.ts';
import type { Outcome } from './evidence.ts';
export function createReport(input: unknown) {
  const { evidence, cases } = assess(input);
  const counts: Record<Outcome, number> = { PASS: 0, FAIL: 0, UNSUPPORTED: 0, UNVERIFIED: 0 };
  for (const c of cases) counts[c.outcome]++;
  return { reportVersion: '2' as const, assessmentKind: 'recorded-run' as const,
    notice: 'Recorded-run assessment — not a live runtime validation.',
    runId: evidence.runId, runtime: evidence.runtime, configuration: evidence.configuration,
    sources: evidence.sources, limitations: evidence.limitations, cases, counts };
}
export type AssessmentReport = ReturnType<typeof createReport>;
export function exitCode(report: AssessmentReport): number { return report.counts.FAIL || report.counts.UNVERIFIED ? 1 : 0; }
export function renderReport(report: AssessmentReport): string {
  return [report.notice, `Run: ${report.runId}`, `Runtime: ${report.runtime}`, `Configuration: ${report.configuration}`,
    ...report.cases.flatMap(c => [`\n${c.outcome} ${c.id} (${c.family})`, `Contract: ${c.contract}`,
      `Native authority: ${c.record.authority?.value.nativeOutcome ?? 'not supplied'}; decision: ${c.record.authority?.value.decisionId ?? 'not supplied'}; enforcement: ${c.record.enforcement?.value.disposition ?? 'not supplied'} (${c.record.enforcement?.value.reason ?? 'not supplied'}); review state: ${c.record.review?.value.nativeState ?? 'not supplied'}`,
      ...c.findings.map(f => `  ${f.outcome} ${f.property}: ${f.reason} [${f.sources.join(', ') || 'no source'}]`),
      ...c.reportedFacts.map(f => `  Source-reported (not independently established here): ${f}`),
      ...c.limitations.map(l => `  Limitation: ${l}`)]),
    '\nSources:', ...report.sources.map(s => `  ${s.id} (${s.kind}): ${s.location} — ${s.description}`),
    ...report.limitations.map(l => `Limitation: ${l}`),
    `\n${report.counts.PASS} passed; ${report.counts.FAIL} failed; ${report.counts.UNSUPPORTED} unsupported; ${report.counts.UNVERIFIED} unverified. Only PASS is proved coverage within the stated bounds.`,
  ].join('\n') + '\n';
}
