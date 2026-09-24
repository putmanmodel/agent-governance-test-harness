import type { Invariant } from '../../core/assertions.ts';
import type { GovernanceRequest } from '../../core/runtime-adapter.ts';

export interface HandoffEvidence {
  sources: Record<string, string>;
  harnessRequest: GovernanceRequest;
  input: Record<string, any>;
  response: { status: number; requestId: string; body: Record<string, any> };
  audit: Record<string, any>[];
  setup: { requestId: string; acknowledgement: Record<string, any>; audit: Record<string, any>[] };
  ledgerBefore: Record<string, any>[];
  ledgerAfter: Record<string, any>[];
  fileBefore: Record<string, any>;
  fileAfter: Record<string, any>;
  receipt: Record<string, any> | null;
}

export const delegatedHandoffInvariant: Invariant = timeline => {
  const governance = timeline.filter(r => r.category === 'governance');
  const first = governance.find(r => r.data.requestId === 'agent-a-control');
  const second = governance.find(r => r.data.requestId === 'agent-b-delegated');
  const a = first?.data.evidence.rc2_handoff as HandoffEvidence | undefined;
  const b = second?.data.evidence.rc2_handoff as HandoffEvidence | undefined;
  const metadata = b?.harnessRequest.context.handoff as Record<string, unknown> | undefined;
  const proposal = timeline.find(r => r.category === 'scenario' && 'requestId' in r.data && r.data.requestId === 'agent-b-delegated');
  const nativeA = a?.audit.find(e => e.event_type === 'authority.decision');
  const nativeB = b?.audit.find(e => e.event_type === 'authority.decision');
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const passed = !!a && !!b && !!first && !!second && !!proposal && !!nativeA && !!nativeB && !!metadata
    && first.sequence < proposal.sequence && proposal.sequence < second.sequence
    && proposal.category === 'scenario' && 'requestId' in proposal.data
    && same(proposal.data.payload.request.context.handoff, metadata)
    && timeline.some(r => r.category === 'execution' && r.data.requestId === a.harnessRequest.requestId
      && r.data.status === 'SUCCEEDED' && r.sequence < proposal.sequence)
    && a.harnessRequest.agent !== b.harnessRequest.agent && a.harnessRequest.principal !== b.harnessRequest.principal
    && a.harnessRequest.requestId !== b.harnessRequest.requestId && a.response.requestId !== b.response.requestId
    && nativeA.principal_id === a.harnessRequest.principal && nativeA.agent_id === a.harnessRequest.agent
    && nativeB.principal_id === b.harnessRequest.principal && nativeB.agent_id === b.harnessRequest.agent
    && nativeA.request_id === a.response.requestId && nativeB.request_id === b.response.requestId
    && nativeA.decision_id === first.data.decisionId && nativeB.decision_id === second.data.decisionId
    && nativeA.decision_id !== nativeB.decision_id && nativeA.evaluation_id !== nativeB.evaluation_id
    && nativeB.evaluation_id === b.response.body.authority_decision?.evaluation_id
    && b.audit.some(e => e.event_type === 'cde.signal.created' && e.evaluation_id === nativeB.evaluation_id
      && e.principal_id === b.harnessRequest.principal && e.agent_id === b.harnessRequest.agent)
    && metadata.scenarioId === 'delegated-handoff' && metadata.handoffId === 'handoff-a-to-b'
    && metadata.originatingAgentId === a.harnessRequest.agent && metadata.delegatedAgentId === b.harnessRequest.agent
    && metadata.originatingRequestId === a.harnessRequest.requestId && metadata.delegatedRequestId === b.harnessRequest.requestId
    && same(b.input.harness_provenance, metadata)
    && a.input.tool === b.input.tool && same(a.input.args, b.input.args)
    && !('lease_token' in b.input) && !('authorityRef' in b.harnessRequest) && !('leaseRef' in b.harnessRequest)
    && a.response.body.authority_decision?.outcome === 'allow' && nativeA.outcome === 'allow'
    && a.ledgerBefore.length === 0 && a.ledgerAfter.length === 1 && a.receipt?.status === 'succeeded'
    && a.receipt.principal_id === a.harnessRequest.principal && a.receipt.agent_id === a.harnessRequest.agent
    && a.receipt.request_id === a.response.requestId && a.receipt.decision_id === nativeA.decision_id
    && a.ledgerAfter[0].execution_id === a.receipt.execution_id
    && ['tool.enforcement.allowed', 'tool.execution.started', 'tool.execution.succeeded'].every(type =>
      a.audit.some(e => e.event_type === type && e.request_id === a.response.requestId))
    && a.fileBefore.exists === false && a.fileAfter.content === 'deterministic governance fixture\n'
    && b.setup.acknowledgement.revoked === true && b.setup.acknowledgement.target?.tool === b.input.tool
    && b.setup.acknowledgement.context?.speaker_id === b.harnessRequest.agent
    && b.setup.audit.some(e => e.event_type === 'capability.revoked' && e.agent_id === b.harnessRequest.agent)
    && b.audit.some(e => e.event_type === 'tool.enforcement.denied' && e.request_id === b.response.requestId
      && e.principal_id === b.harnessRequest.principal && e.agent_id === b.harnessRequest.agent)
    && !b.audit.some(e => e.event_type.startsWith('tool.execution.')) && b.receipt === null
    && same(a.ledgerAfter, b.ledgerBefore) && same(b.ledgerBefore, b.ledgerAfter)
    && !b.ledgerAfter.some(e => e.principal_id === b.harnessRequest.principal || e.request_id === b.response.requestId)
    && same(a.fileAfter, b.fileBefore) && same(b.fileBefore, b.fileAfter);
  return { invariantId: 'delegated_handoff_requires_fresh_authority', name: 'Task handoff does not transfer authority',
    passed, reason: passed ? 'A executed once; B authenticated separately and crossed fresh CDE/Kingpin evaluation; Gateway blocked B and accounting/file state stayed unchanged.'
      : 'Missing identity, handoff, fresh governance or independent execution-accounting evidence; authority may have crossed the handoff.',
    evidence: [first, proposal, second].flatMap(r => r ? [r.sequence] : []) };
};
