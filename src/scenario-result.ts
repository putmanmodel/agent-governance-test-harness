import type { AssertionResult } from './core/assertions.ts';
import type { TimelineRecord } from './core/timeline.ts';

// Driver output, not the public report: native evidence stays inside timelines.
export interface ScenarioCaseResult {
  passed: boolean;
  assertions?: readonly AssertionResult[];
  timeline?: readonly TimelineRecord[];
}
export interface ScenarioDriverResult extends ScenarioCaseResult {
  cases?: Readonly<Record<string, ScenarioCaseResult>>;
  artifacts?: readonly ArtifactReference[];
}
export interface ArtifactReference { path: string; case?: string }
export interface FailureDiagnostic { invariantId: string; reason: string; case?: string }

export function failedAssertions(result: ScenarioDriverResult): FailureDiagnostic[] {
  const collect = (value: ScenarioCaseResult, label?: string): FailureDiagnostic[] =>
    (value.assertions ?? []).filter(a => !a.passed).map(a => ({ invariantId: a.invariantId, reason: a.reason,
      ...(label === undefined ? {} : { case: label }) }));
  return [...collect(result), ...Object.entries(result.cases ?? {}).flatMap(([label, value]) => collect(value, label))];
}
