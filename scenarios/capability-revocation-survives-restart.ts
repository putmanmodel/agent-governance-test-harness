import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { restartInvariant } from '../src/adapters/kingpin-rc2/restart-assertion.ts';
export const restartRequest: GovernanceRequest = {
  requestId: 'restart-before', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'capability-revocation-survives-restart' }, context: {},
};
export const restartScenario: Scenario = {
  id: restartRequest.provenance.scenarioId, events: [
    { type: 'PROPOSE', order: 1, timestamp: 0, requestId: 'restart-before', payload: { request: restartRequest, executionOutcome: 'SUCCEEDED' } },
    { type: 'REVOKE', order: 2, timestamp: 1, payload: { authorityRef: 'write-capability' } },
    { type: 'PROPOSE', order: 3, timestamp: 2, requestId: 'restart-after', payload: {
      request: { ...restartRequest, requestId: 'restart-after', context: { afterProcessReplacement: true } }, executionOutcome: 'SUCCEEDED' } },
  ], invariants: [restartInvariant],
};
