import { retryAfterRevocation, revokedAuthorityInvariant } from '../../../scenarios/retry-after-revocation.ts';
import type { Invariant } from '../../core/assertions.ts';
import { runScenario } from '../../core/runner.ts';
import { createGatewayAdapter } from './gateway.ts';
import type { GatewayEvidence } from './gateway.ts';

// Assertions consume recorded facts. They neither calculate nor replace authority decisions.
export const gatewayInvariant: Invariant = timeline => {
  const base = revokedAuthorityInvariant(timeline);
  const decisions = timeline.filter(r => r.category === 'governance');
  const first = decisions.find(r => r.data.requestId === 'request-1')?.data.evidence.kingpin_rc2_gateway as GatewayEvidence | undefined;
  const retry = decisions.find(r => r.data.requestId === 'request-2')?.data.evidence.kingpin_rc2_gateway as GatewayEvidence | undefined;
  const id = first?.receipt?.execution_id;
  const completion = first?.reconciled;
  const revoke = retry?.controls.find(c => c.type === 'REVOKE');
  const nativeProof = !!first && !!retry && typeof id === 'string'
    && first.native.outcome === 'allow'
    && first.audit.some(e => e.event_type === 'tool.enforcement.allowed')
    && ['tool.execution.started', 'tool.execution.unknown', 'tool.execution.reconciled_succeeded'].every(type =>
      first.audit.some(e => e.event_type === type && e.execution_id === id && e.request_id === first.nativeRequestId))
    && first.receipt?.status === 'unknown'
    && completion?.execution_id === id && completion?.status === 'reconciled_succeeded'
    && completion?.reconciliation?.method === 'adapter' && completion?.reconciliation?.outcome === 'succeeded'
    && first.fileBefore.exists === false && first.fileAfter.content === 'deterministic governance fixture\n'
    && first.ledgerBefore.length === 0 && first.ledgerAfter.length === 1
    && first.ledgerAfter[0].execution_id === id
    && first.nativeRequestId !== retry.nativeRequestId
    && retry.harnessRequest.provenance.retryOf === first.harnessRequest.requestId
    && first.controls.every(c => c.type !== 'REVOKE')
    && revoke?.acknowledgement?.revoked === true && revoke?.validation?.reason === 'capability_revoked'
    && revoke?.audit.some((e: Record<string, unknown>) => e.event_type === 'capability.revoked')
    && retry.audit.some(e => e.event_type === 'tool.enforcement.denied' && e.request_id === retry.nativeRequestId)
    && !retry.audit.some(e => e.event_type.startsWith('tool.execution.'))
    && retry.receipt === null && retry.ledgerAfter.length === 1
    && JSON.stringify(first.ledgerAfter) === JSON.stringify(retry.ledgerBefore)
    && JSON.stringify(retry.ledgerBefore) === JSON.stringify(retry.ledgerAfter)
    && JSON.stringify(first.fileAfter) === JSON.stringify(retry.fileBefore)
    && JSON.stringify(retry.fileBefore) === JSON.stringify(retry.fileAfter);
  return { ...base, passed: base.passed && nativeProof,
    reason: base.passed && nativeProof
      ? 'RC2 recorded a write, UNKNOWN and successful reconciliation; acknowledged capability revocation preceded fresh blocked redispatch; ledger and file remained unchanged.'
      : 'Missing native enforcement/execution/revocation evidence, changed fixture/accounting, or failed retry invariant.' };
};

export async function runGatewayScenario() {
  const proposal = retryAfterRevocation.events[1];
  if (!('requestId' in proposal)) throw new Error('Missing original request');
  const connected = await createGatewayAdapter(proposal.payload.request);
  try {
    return await runScenario({ ...retryAfterRevocation, invariants: [gatewayInvariant] }, connected.runtime, connected.observe);
  } finally { await connected.close(); }
}
