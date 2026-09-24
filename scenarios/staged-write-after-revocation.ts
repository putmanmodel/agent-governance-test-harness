import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { stagedInvariant } from '../src/adapters/kingpin-rc2/staged-assertion.ts';
export const deferredRecord = { deferred_action_id: 'deferred-1', originating_request_id: 'stage-create',
  target_action: 'fs.write', target_resource: 'effect.txt', relation: 'staged-for-later-execution' };
export const stagedContent = JSON.stringify(deferredRecord) + '\n';
export const stageRequest: GovernanceRequest = {
  requestId: 'stage-create', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'staged-write-after-revocation' }, context: { deferred: deferredRecord, phase: 'stage' },
};
export const stagedWrite: Scenario = {
  id: 'staged-write-after-revocation', events: [
    { type: 'PROPOSE', order: 1, timestamp: 0, requestId: stageRequest.requestId, payload: { request: stageRequest, executionOutcome: 'SUCCEEDED' } },
    { type: 'REVOKE', order: 2, timestamp: 1, payload: { authorityRef: 'write-capability' } },
    { type: 'PROPOSE', order: 3, timestamp: 2, requestId: 'stage-due', payload: {
      request: { ...stageRequest, requestId: 'stage-due', context: { deferred: deferredRecord, phase: 'due' } }, executionOutcome: 'SUCCEEDED' } },
  ], invariants: [stagedInvariant],
};
