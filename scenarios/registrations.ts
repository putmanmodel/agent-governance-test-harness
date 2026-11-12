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
export const unknownRestartRegistration: ScenarioRegistration = {
  id: 'unknown-execution-survives-restart', name: 'UNKNOWN Execution Survives Restart',
  requires: ['execution-accounting', 'durable-restart', 'reconciliation'],
};
export const approvedRestartRegistration: ScenarioRegistration = {
  id: 'approved-review-revocation-survives-restart', name: 'Approved Review Revocation Survives Restart',
  requires: ['human-review', 'revocation', 'execution-accounting', 'durable-restart'],
};
export const foreignReviewRegistration: ScenarioRegistration = {
  id: 'approved-review-foreign-principal-ingress-refusal', name: 'Approved Review Foreign Principal Ingress Refusal',
  requires: ['multi-principal', 'human-review', 'execution-accounting'],
};
export const contractionCases = ['H4-SQLite-CR-04', 'H4-SQLite-CR-05', 'H4-SQLite-CR-06'] as const;
export const contractionRegistrations: ScenarioRegistration[] = [
  { id: 'H4-SQLite-CR-03', name: 'Remove runtime.evaluate while retaining agent role and identity',
    requires: ['per-agent-permission-override'] },
  ...contractionCases.map((id): ScenarioRegistration => ({ id, name: id,
    requires: ['sqlite-credential-rotation', 'durable-restart', 'human-review', 'execution-accounting', ...(id.endsWith('05') ? ['revocation'] as const : [])] })),
];
export const sqliteRotationCases = ['H3-SQLite-CR-01', 'H3-SQLite-CR-02'] as const;
export const sqliteRegistrations: ScenarioRegistration[] = sqliteRotationCases.map(id => ({
  id, name: id, requires: ['sqlite-credential-rotation', 'durable-restart', 'human-review', 'execution-accounting'],
}));
export const memoryRotationCases = ['H3-Memory-CR-01', 'H3-Memory-CR-02'] as const;
export const rotationRegistrations: ScenarioRegistration[] = memoryRotationCases.map(id => ({
  id, name: id, requires: ['memory-credential-rotation', 'human-review', 'execution-accounting'],
}));
export const currentScenarioRegistrations = [retryRegistration, reviewRegistration, handoffRegistration, inFlightRegistration, stagedRegistration, restartRegistration, reviewRestartRegistration, unknownRestartRegistration, approvedRestartRegistration, foreignReviewRegistration] as const;
