import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { inFlightInvariant } from '../src/adapters/kingpin-rc2/in-flight-assertion.ts';

export const inFlightRequest: GovernanceRequest = {
  requestId: 'in-flight-first', principal: 'principal-a', agent: 'agent-a',
  proposedAction: 'action-x', target: 'target-x', provenance: { scenarioId: 'in-flight-revocation' }, context: {},
};
export const inFlightRevocation: Scenario = {
  id: 'in-flight-revocation', events: [
    { order: 1, timestamp: 0, type: 'PROPOSE', requestId: inFlightRequest.requestId,
      payload: { request: inFlightRequest, executionOutcome: 'SUCCEEDED' } },
    { order: 2, timestamp: 1, type: 'RETRY', requestId: 'in-flight-later', payload: {
      request: { ...inFlightRequest, requestId: 'in-flight-later',
        provenance: { ...inFlightRequest.provenance, retryOf: inFlightRequest.requestId } }, executionOutcome: 'SUCCEEDED' } },
  ], invariants: [inFlightInvariant],
};
