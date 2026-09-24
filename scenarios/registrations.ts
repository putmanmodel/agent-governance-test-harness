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
export const stagedRegistration: ScenarioRegistration = {
  id: 'staged-write-after-revocation', name: 'Staged Write After Revocation', requires: ['revocation', 'execution-accounting'],
};
export const restartRegistration: ScenarioRegistration = {
  id: 'capability-revocation-survives-restart', name: 'Capability Revocation Survives Restart',
  requires: ['revocation', 'execution-accounting', 'durable-restart'],
};
export const reviewRestartRegistration: ScenarioRegistration = {
  id: 'human-approval-consumption-survives-restart', name: 'Human Approval Consumption Survives Restart',
  requires: ['human-review', 'execution-accounting', 'durable-restart'],
};
export const currentScenarioRegistrations = [retryRegistration, reviewRegistration, handoffRegistration, inFlightRegistration, stagedRegistration, restartRegistration, reviewRestartRegistration] as const;
