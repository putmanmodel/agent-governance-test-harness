import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Scenario } from '../src/core/scenario.ts';
import { humanApprovalInvariant } from '../src/adapters/kingpin-rc2/review-assertion.ts';

export const reviewedRequest: GovernanceRequest = {
  requestId: 'review-original', principal: 'principal-a', agent: 'agent-a',
  proposedAction: 'action-x', target: 'target-x',
  provenance: { scenarioId: 'human-approval-replay' }, context: { reviewPhase: 'request' },
};
export const humanApprovalReplay: Scenario = {
  id: 'human-approval-replay',
  events: [
    { order: 1, timestamp: 0, type: 'PROPOSE', requestId: reviewedRequest.requestId,
      payload: { request: reviewedRequest, executionOutcome: 'SUCCEEDED' } },
    { order: 2, timestamp: 1, type: 'GRANT', payload: { authorityRef: 'original-review' } },
    { order: 3, timestamp: 2, type: 'PROPOSE', requestId: 'review-consume', payload: {
      request: { ...reviewedRequest, requestId: 'review-consume', context: { reviewPhase: 'consume' } }, executionOutcome: 'SUCCEEDED' } },
    { order: 4, timestamp: 3, type: 'RETRY', requestId: 'review-replay', payload: {
      request: { ...reviewedRequest, requestId: 'review-replay', context: { reviewPhase: 'replay' },
        provenance: { ...reviewedRequest.provenance, retryOf: reviewedRequest.requestId } }, executionOutcome: 'SUCCEEDED' } },
  ],
  invariants: [humanApprovalInvariant],
};
