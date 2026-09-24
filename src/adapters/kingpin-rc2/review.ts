import { humanApprovalReplay, reviewedRequest } from '../../../scenarios/human-approval-replay.ts';
import type { RuntimeAdapter, RuntimeDecision } from '../../core/runtime-adapter.ts';
import type { ExecutionStatus } from '../../core/events.ts';
import type { ObserveEffects } from '../../core/runner.ts';
import { runScenario } from '../../core/runner.ts';
import { createGatewayAdapter } from './gateway.ts';
import { normalizeDecision } from './adapter.ts';
import type { ReviewEvidence } from './review-assertion.ts';

export function reviewEffects(requestId: string, decision: RuntimeDecision): Awaited<ReturnType<ObserveEffects>> {
  const e = decision.evidence.rc2_review as ReviewEvidence;
  const consume = e.harnessRequest.context.reviewPhase === 'consume';
  if (consume) {
    const statuses: Record<string, ExecutionStatus> = { 'tool.execution.started': 'STARTED', 'tool.execution.succeeded': 'SUCCEEDED',
      'tool.execution.failed': 'FAILED', 'tool.execution.unknown': 'UNKNOWN' };
    const events = e.originalAudit.filter(r => r.execution_id === e.receipt?.execution_id);
    return { enforcement: e.originalAudit.some(r => r.event_type === 'tool.enforcement.allowed') ? 'DISPATCH' : 'BLOCK',
      executions: events.filter(r => ['tool.execution.started', 'tool.execution.succeeded', 'tool.execution.failed', 'tool.execution.unknown'].includes(r.event_type)).map(r => ({
        requestId, status: statuses[r.event_type],
        reason: `rc2:execution ${r.event_type}; execution_id=${r.execution_id}`,
      })) };
  }
  const unchanged = JSON.stringify(e.ledgerBefore) === JSON.stringify(e.ledgerAfter)
    && JSON.stringify(e.fileBefore) === JSON.stringify(e.fileAfter);
  return { enforcement: e.response.body.allow === true || e.replayResponse?.body.execution_authorized === true ? 'DISPATCH' : 'BLOCK',
    executions: [{ requestId, status: unchanged ? 'NOT_STARTED' : 'UNKNOWN',
      reason: unchanged ? 'rc2:gateway review hold/refusal; ledger and harness file inspection unchanged.' : 'Observed accounting or file changed during attempted replay.' }] };
}

export async function runHumanApprovalReplay() {
  const f = await createGatewayAdapter(reviewedRequest, { receiptFailure: false, reviewer: true });
  try {
    const body = { ...f.input(reviewedRequest), plan_id: 'bound-human-review-operation', user_request: '.' };
    // Real CDE warmup taken from RC2's human_review conformance fixture; no supplied signal.
    const warmup = await f.http('/turn', { session_id: reviewedRequest.provenance.scenarioId, speaker_id: reviewedRequest.agent,
      channel_id: 'channel', scene_id: 'scene', turn_id: 'review-warmup', ts: 0, text: 'You need to do it now immediately.' });
    if (warmup.status !== 200) throw new Error('Real CDE warmup failed');
    let reviewId: string | undefined, originalId: string | undefined;
    let approval: ReviewEvidence['response'] | undefined;
    const exchanges: ReviewEvidence['exchanges'] = [];
    // Sequential HTTP observations retain the exact path actually sent, including replay target.
    async function exchange(path: string, role: 'agent' | 'reviewer' = 'agent') {
      const response = await f.http(path, role === 'reviewer' ? {} : body, role);
      exchanges.push({ sequence: exchanges.length + 1, path, requestId: response.requestId, status: response.status });
      return response;
    }
    const used = new Set<string>();
    const runtime: RuntimeAdapter = {
      async inject(control) {
        if (control.type !== 'GRANT' || control.authorityRef !== 'original-review' || !reviewId) throw new Error('Unknown review control');
        approval = await exchange(`/reviews/${reviewId}/approve`, 'reviewer');
        if (approval.status !== 200) throw new Error('RC2 approval request failed');
      },
      async submit(request) {
        if (used.has(request.requestId)) throw new Error('Fresh harness request ID required');
        used.add(request.requestId);
        const ledgerBefore = f.ledger(), fileBefore = f.inspect();
        const phase = request.context.reviewPhase;
        const response = phase === 'consume' ? await exchange(`/reviews/${reviewId}/execute`)
          : await exchange('/tool/observed');
        if (phase === 'request') {
          reviewId = response.reviewId ?? undefined; originalId = response.requestId;
          if (!reviewId) throw new Error('RC2 did not request HUMAN REVIEW');
        }
        const replayResponse = phase === 'replay' ? await exchange(`/reviews/${reviewId}/execute`) : undefined;
        const inspection = await f.http(`/reviews/${phase === 'replay' ? response.reviewId : reviewId}`, undefined, 'reviewer');
        if (inspection.status !== 200) throw new Error('Native review inspection failed');
        const receipt = response.body.execution_id ? await f.readExecutionReceipt(response.body.execution_id) : undefined;
        const originalReviewAfter = phase === 'replay' ? await f.http(`/reviews/${reviewId}`, undefined, 'reviewer') : undefined;
        const audit = await f.audit(response.requestId), originalAudit = await f.audit(originalId!);
        const native = response.body.authority_decision;
        if (!native) throw new Error('Native authority decision missing');
        const evidence: ReviewEvidence = {
          source: { scenario: 'harness', cde: 'rc2:cde', governance: 'rc2:kingpin', review: 'rc2:review', enforcement: 'rc2:gateway', execution: 'rc2:execution' },
          originalReviewId: reviewId!, exchanges: structuredClone(exchanges),
          harnessRequest: structuredClone(request), input: structuredClone(body), response, replayResponse, review: inspection.body,
          replayAudit: replayResponse ? await f.audit(replayResponse.requestId) : [],
          approval: approval && structuredClone(approval), originalReviewAfter: originalReviewAfter?.body,
          audit, originalAudit, ledgerBefore, ledgerAfter: f.ledger(), fileBefore, fileAfter: f.inspect(), receipt,
        };
        const decisionId = phase === 'consume' ? inspection.body.decision_id
          : audit.find(e => e.event_type === 'authority.decision')?.decision_id;
        if (!decisionId) throw new Error('Missing native decision correlation');
        return { requestId: request.requestId, decisionId, result: normalizeDecision(native),
          rationale: native.reason, evidence: { rc2_review: evidence } };
      },
    };
    return await runScenario(humanApprovalReplay, runtime, async (request, decision) => reviewEffects(request.requestId, decision));
  } finally { await f.close(); }
}
