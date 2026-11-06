import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { approvedRestartInvariant } from '../src/adapters/kingpin-rc2/approved-restart-assertion.ts';
export const approvedRestartRequest: GovernanceRequest = {
  requestId: 'approved-restart-held', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'approved-review-revocation-survives-restart' }, context: {},
};
// Preserve the initial native HUMAN REVIEW. Failed consumption is compound evidence, not a fresh decision.
export const approvedRestartScenario: Scenario = {
  id: approvedRestartRequest.provenance.scenarioId,
  events: [{ type: 'PROPOSE', order: 1, timestamp: 0, requestId: approvedRestartRequest.requestId,
    payload: { request: approvedRestartRequest, executionOutcome: 'SUCCEEDED' } }], invariants: [approvedRestartInvariant],
};
