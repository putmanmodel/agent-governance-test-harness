import type { Scenario } from '../src/core/scenario.ts';
import type { GovernanceRequest } from '../src/core/runtime-adapter.ts';
import type { Invariant } from '../src/core/assertions.ts';

const request: GovernanceRequest = {
  requestId: 'request-1', principal: 'principal-a', agent: 'agent-a',
  proposedAction: 'action-x', target: 'target-x', authorityRef: 'authority-1',
  provenance: { scenarioId: 'retry-after-revocation' }, context: {},
};

export const revokedAuthorityInvariant: Invariant = timeline => {
  const grant = timeline.find(r => r.category === 'scenario' && r.data.type === 'GRANT'
    && r.data.payload.authorityRef === 'authority-1');
  const initial = timeline.find(r => r.category === 'governance' && r.data.requestId === 'request-1' && r.data.result === 'ALLOW');
  const unknown = timeline.find(r => r.category === 'execution' && r.data.requestId === 'request-1' && r.data.status === 'UNKNOWN');
  const revoked = timeline.find(r => r.category === 'scenario' && r.data.type === 'REVOKE'
    && r.data.payload.authorityRef === 'authority-1');
  const retry = timeline.find(r => r.category === 'scenario' && r.data.type === 'RETRY'
    && r.data.requestId === 'request-2' && r.data.payload.request.provenance.retryOf === 'request-1'
    && r.data.payload.request.authorityRef === 'authority-1');
  const decisions = timeline.filter(r => r.category === 'governance' && r.data.requestId === 'request-2');
  const decision = decisions[0];
  const blocked = timeline.find(r => r.category === 'enforcement' && r.data.requestId === 'request-2' && r.data.result === 'BLOCK');
  const notStarted = timeline.find(r => r.category === 'execution' && r.data.requestId === 'request-2' && r.data.status === 'NOT_STARTED');
  const chain = [grant, initial, unknown, revoked, retry, decision, blocked, notStarted];
  const ordered = chain.every((r, i) => r !== undefined && (i === 0 || r.sequence > (chain[i - 1]?.sequence ?? Infinity)));
  const freshDenial = decisions.length === 1 && decision?.category === 'governance'
    && decision.data.result === 'DENY' && initial?.category === 'governance'
    && decision.data.decisionId !== initial.data.decisionId
    && blocked?.category === 'enforcement' && blocked.data.decisionId === decision.data.decisionId;
  const retryExecuted = timeline.some(r =>
    (r.category === 'execution' && r.data.requestId === 'request-2' && r.data.status !== 'NOT_STARTED')
    || (r.category === 'enforcement' && r.data.requestId === 'request-2' && r.data.result === 'DISPATCH'));
  const passed = ordered && freshDenial && !retryExecuted;
  return {
    invariantId: 'revoked-authority-stays-revoked',
    name: 'Revoked authority must not become valid through retry/recovery',
    passed,
    reason: passed ? 'Retry received a new denial after revocation and no effect was dispatched.'
      : 'Missing required scenario evidence, fresh denial, or blocked retry; historical permission may have been reused.',
    evidence: chain.flatMap(r => r ? [r.sequence] : []),
  };
};

export const retryAfterRevocation: Scenario = {
  id: 'retry-after-revocation',
  events: [
    { timestamp: 0, order: 1, type: 'GRANT', principal: 'principal-a', agent: 'agent-a', payload: { authorityRef: 'authority-1' } },
    { timestamp: 1, order: 2, type: 'PROPOSE', requestId: 'request-1', payload: { request, executionOutcome: 'UNKNOWN' } },
    { timestamp: 2, order: 3, type: 'REVOKE', payload: { authorityRef: 'authority-1' } },
    { timestamp: 3, order: 4, type: 'RETRY', requestId: 'request-2', payload: {
      request: { ...request, requestId: 'request-2', provenance: { ...request.provenance, retryOf: 'request-1' } },
      executionOutcome: 'SUCCEEDED',
    } },
  ],
  invariants: [revokedAuthorityInvariant],
};
