import { delegatedHandoff, originatingRequest, delegatedRequest } from '../../../scenarios/delegated-handoff.ts';
import { createGatewayAdapter, translateEffects } from './gateway.ts';
import type { HandoffEvidence } from './handoff-assertion.ts';
import type { RuntimeAdapter } from '../../core/runtime-adapter.ts';
import { runScenario } from '../../core/runner.ts';
import { normalizeDecision } from './adapter.ts';

export async function runDelegatedHandoff() {
  const sessionB = 'delegated-handoff-agent-b';
  const f = await createGatewayAdapter(originatingRequest, { receiptFailure: false,
    delegatedAgent: { principal: delegatedRequest.principal, agent: delegatedRequest.agent, sessionId: sessionB } });
  try {
    const inputA = f.input(originatingRequest);
    const inputB = { ...inputA, speaker_id: delegatedRequest.agent, session_id: sessionB,
      plan_id: delegatedRequest.requestId, harness_provenance: delegatedRequest.context.handoff };
    // Evaluate B's own context safely, then use RC2's existing capability-revocation control.
    const evaluated = await f.http('/tool/observed', { ...inputB, tool: 'fs.read', args: { path: 'seed.txt' } }, 'delegate');
    if (evaluated.status !== 200) throw new Error('Agent B context setup failed');
    const revoke = await f.http('/revoke', inputB, 'admin');
    const revocationAudit = await f.audit(revoke.requestId);
    if (revoke.status !== 200 || revoke.body.revoked !== true || revoke.body.target?.tool !== 'fs.write'
      || revoke.body.context?.speaker_id !== delegatedRequest.agent
      || !revocationAudit.some(e => e.event_type === 'capability.revoked' && e.agent_id === delegatedRequest.agent)) {
      throw new Error('B capability setup not acknowledged by RC2');
    }
    const setup = { requestId: revoke.requestId, acknowledgement: revoke.body, audit: revocationAudit };
    const seen = new Set<string>();
    const runtime: RuntimeAdapter = {
      async inject() { throw new Error('This handoff does not transfer authority'); },
      async submit(request) {
        const isB = request.requestId === delegatedRequest.requestId;
        const expected = isB ? delegatedRequest : originatingRequest;
        if (request.requestId !== expected.requestId || request.agent !== expected.agent || request.principal !== expected.principal
          || seen.has(request.requestId)) throw new Error('Unexpected handoff identity/request');
        seen.add(request.requestId);
        const input = isB ? inputB : inputA;
        const ledgerBefore = f.ledger(), fileBefore = f.inspect();
        const response = await f.http('/tool/observed', input, isB ? 'delegate' : 'agent');
        const audit = await f.audit(response.requestId);
        const decision = audit.find(e => e.event_type === 'authority.decision');
        if (!decision || !response.body.authority_decision) throw new Error('Fresh native decision missing');
        let receipt = null;
        if (response.body.execution_id) {
          const accounting = await f.http(`/executions/${response.body.execution_id}`, undefined, 'admin');
          if (accounting.status !== 200) throw new Error('Native receipt unavailable');
          receipt = accounting.body;
        }
        const evidence: HandoffEvidence = {
          sources: { handoff: 'harness', cde: 'rc2:cde', authority: 'rc2:kingpin', enforcement: 'rc2:gateway', execution: 'rc2:execution' },
          harnessRequest: structuredClone(request), input: structuredClone(input), response, audit, setup,
          ledgerBefore, ledgerAfter: f.ledger(), fileBefore, fileAfter: f.inspect(), receipt,
        };
        return { requestId: request.requestId, decisionId: decision.decision_id,
          result: normalizeDecision(response.body.authority_decision), rationale: response.body.authority_decision.reason,
          evidence: { rc2_handoff: evidence } };
      },
    };
    return await runScenario(delegatedHandoff, runtime, async (request, decision) => {
      const e = decision.evidence.rc2_handoff as HandoffEvidence;
      // Reuse existing native enforcement/execution translation, without synthesizing a decision.
      return translateEffects(request.requestId, { ...e, nativeRequestId: e.response.requestId });
    });
  } finally { await f.close(); }
}
