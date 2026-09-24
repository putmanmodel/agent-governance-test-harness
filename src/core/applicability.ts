import { failedAssertions } from '../scenario-result.ts';
import type { ScenarioDriverResult, FailureDiagnostic, ArtifactReference } from '../scenario-result.ts';

export type RuntimeCapability = 'revocation' | 'human-review' | 'execution-accounting'
  | 'durable-restart' | 'reconciliation' | 'multi-principal' | 'in-flight-observation';

export interface RuntimeDeclaration {
  readonly id: string;
  readonly capabilities: readonly RuntimeCapability[];
}
export interface ScenarioRegistration {
  readonly id: string;
  readonly name: string;
  readonly requires: readonly RuntimeCapability[];
}
export interface ApplicabilityResult {
  runtimeId: string;
  scenarioId: string;
  scenarioName: string;
  status: 'PASS' | 'FAIL' | 'UNSUPPORTED';
  missingCapabilities: RuntimeCapability[];
  reason: string;
  diagnostics?: FailureDiagnostic[];
  artifacts?: readonly ArtifactReference[];
}

// Callbacks include fixture/process creation so unsupported paths never start execution.
// Explicit caller requirements cannot be waived by a runtime's declaration.
export async function runApplicable(
  runtime: RuntimeDeclaration,
  scenario: ScenarioRegistration,
  execute: () => Promise<ScenarioDriverResult>,
  requiredCapabilities: readonly RuntimeCapability[] = [],
): Promise<ApplicabilityResult> {
  const missing = (required: readonly RuntimeCapability[]) => [...new Set(required)]
    .filter(capability => !runtime.capabilities.includes(capability));
  const base = { runtimeId: runtime.id, scenarioId: scenario.id, scenarioName: scenario.name };
  const requiredMissing = missing(requiredCapabilities);
  if (requiredMissing.length) return { ...base, status: 'FAIL', missingCapabilities: requiredMissing,
    reason: 'Runtime does not meet explicit caller capability requirements.' };
  const scenarioMissing = missing(scenario.requires);
  if (scenarioMissing.length) return { ...base, status: 'UNSUPPORTED', missingCapabilities: scenarioMissing,
    reason: 'Runtime lacks scenario prerequisites; execution was not attempted.' };
  try {
    const result = await execute();
    const diagnostics = result.passed ? [] : failedAssertions(result);
    return { ...base, status: result.passed ? 'PASS' : 'FAIL', missingCapabilities: [],
      reason: result.passed ? 'Scenario assertions passed.' : 'Scenario assertions failed.',
      ...(diagnostics.length ? { diagnostics } : {}),
      ...(result.artifacts?.length ? { artifacts: result.artifacts } : {}) };
  } catch (error) {
    return { ...base, status: 'FAIL', missingCapabilities: [],
      reason: error instanceof Error ? error.message : String(error) };
  }
}

export function summarizeApplicability(results: readonly ApplicabilityResult[]) {
  return {
    passed: results.filter(r => r.status === 'PASS').length,
    failed: results.filter(r => r.status === 'FAIL').length,
    unsupported: results.filter(r => r.status === 'UNSUPPORTED').length,
  };
}
