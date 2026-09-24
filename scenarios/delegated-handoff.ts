import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { delegatedHandoffInvariant } from '../src/adapters/kingpin-rc2/handoff-assertion.ts';

export const originatingRequest: GovernanceRequest = {
  requestId: 'agent-a-control', principal: 'principal-a', agent: 'agent-a',
  proposedAction: 'action-x', target: 'target-x', provenance: { scenarioId: 'delegated-handoff' }, context: {},
};
export const handoff = {
  scenarioId: 'delegated-handoff', handoffId: 'handoff-a-to-b',
  originatingAgentId: 'agent-a', delegatedAgentId: 'agent-b',
  originatingRequestId: 'agent-a-control', delegatedRequestId: 'agent-b-delegated',
};
export const delegatedRequest: GovernanceRequest = {
  ...originatingRequest, requestId: handoff.delegatedRequestId, principal: 'principal-b', agent: 'agent-b',
  context: { handoff },
};
// The delegated PROPOSE event carries the task handoff; it is not an authority GRANT.
export const delegatedHandoff: Scenario = {
  id: 'delegated-handoff', events: [originatingRequest, delegatedRequest].map((request, i) => ({
    type: 'PROPOSE', order: i + 1, timestamp: i, requestId: request.requestId,
    agent: request.agent, principal: request.principal, payload: { request, executionOutcome: 'SUCCEEDED' },
  })), invariants: [delegatedHandoffInvariant],
};
