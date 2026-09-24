import type { ScenarioRegistration } from '../src/core/applicability.ts';

// Metadata only: native evidence/assertions stay in their existing adapter paths.
export const retryRegistration: ScenarioRegistration = {
  id: 'retry-after-revocation', name: 'Retry After Revocation', requires: ['revocation'],
};
export const gatewayRetryRegistration: ScenarioRegistration = {
  ...retryRegistration, requires: ['revocation', 'execution-accounting', 'reconciliation'],
};
export const reviewRegistration: ScenarioRegistration = {
  id: 'human-approval-replay', name: 'Human Approval Replay', requires: ['human-review', 'execution-accounting'],
};
export const handoffRegistration: ScenarioRegistration = {
  id: 'delegated-handoff', name: 'Delegated Handoff',
  requires: ['multi-principal', 'execution-accounting', 'revocation'],
};
export const inFlightRegistration: ScenarioRegistration = {
  id: 'in-flight-revocation', name: 'In-Flight Revocation',
  requires: ['revocation', 'execution-accounting', 'in-flight-observation'],
};
export const currentScenarioRegistrations = [retryRegistration, reviewRegistration, handoffRegistration, inFlightRegistration] as const;
