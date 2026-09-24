import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { unknownRestartInvariant } from '../src/adapters/kingpin-rc2/unknown-restart-assertion.ts';
export const unknownRestartRequest: GovernanceRequest = {
  requestId: 'unknown-restart-write', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'unknown-execution-survives-restart' }, context: {},
};
export const unknownRestartScenario: Scenario = {
  id: unknownRestartRequest.provenance.scenarioId,
  events: [{ type: 'PROPOSE', order: 1, timestamp: 0, requestId: unknownRestartRequest.requestId,
    payload: { request: unknownRestartRequest, executionOutcome: 'UNKNOWN' } }], invariants: [unknownRestartInvariant],
};
