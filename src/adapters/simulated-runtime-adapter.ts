import type { GovernanceRequest, RuntimeAdapter, RuntimeDecision } from '../core/runtime-adapter.ts';

// Single-authority fixture only; not a production authority or policy implementation.
export class SimulatedRuntimeAdapter implements RuntimeAdapter {
  #active = new Set<string>();
  #previouslyAllowed = new Set<string>();
  #decisionCount = 0;
  #reuseRevokedAuthority: boolean;

  constructor(options: { reuseRevokedAuthority?: boolean } = {}) {
    this.#reuseRevokedAuthority = options.reuseRevokedAuthority ?? false;
  }

  async inject(control: { type: 'GRANT' | 'REVOKE'; authorityRef: string }): Promise<void> {
    if (control.type === 'GRANT') this.#active.add(control.authorityRef);
    else this.#active.delete(control.authorityRef);
  }

  async submit(request: GovernanceRequest): Promise<RuntimeDecision> {
    const active = request.authorityRef !== undefined && this.#active.has(request.authorityRef);
    const reused = this.#reuseRevokedAuthority && request.provenance.retryOf !== undefined
      && this.#previouslyAllowed.has(request.provenance.retryOf);
    const allowed = active || reused;
    if (allowed) this.#previouslyAllowed.add(request.requestId);
    return {
      decisionId: `decision-${++this.#decisionCount}`,
      requestId: request.requestId,
      result: allowed ? 'ALLOW' : 'DENY',
      rationale: reused ? 'Deliberately broken: reused historical permission.'
        : active ? 'Fixture authority is active.' : 'Fixture authority is absent or revoked.',
      evidence: { activeAtSubmission: active, reusedHistoricalPermission: reused },
      ...(request.authorityRef ? { authority: {
        reference: request.authorityRef, state: active ? 'ACTIVE' : 'REVOKED',
      } } : {}),
    };
  }
}
