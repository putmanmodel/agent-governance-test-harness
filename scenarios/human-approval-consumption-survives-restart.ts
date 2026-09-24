import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { reviewRestartInvariant } from '../src/adapters/kingpin-rc2/review-restart-assertion.ts';
export const reviewRestartRequest: GovernanceRequest = {
  requestId: 'review-restart-consume', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'human-approval-consumption-survives-restart' }, context: {},
};
// The compound review experiment is retained in native evidence; no fabricated replay decision.
export const reviewRestartScenario: Scenario = {
  id: reviewRestartRequest.provenance.scenarioId,
  events: [{ type: 'PROPOSE', order: 1, timestamp: 0, requestId: reviewRestartRequest.requestId,
    payload: { request: reviewRestartRequest, executionOutcome: 'SUCCEEDED' } }], invariants: [reviewRestartInvariant],
};
