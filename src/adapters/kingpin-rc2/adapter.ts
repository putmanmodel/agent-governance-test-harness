import type { GovernanceRequest, RuntimeAdapter, RuntimeDecision } from '../../core/runtime-adapter.ts';
import type { ActionBinding, AuthorityRequest, CdeTurn, Lease, NativeDecision, NativeObject, Rc2Boundary } from './contracts.ts';

export function mapRequest(request: GovernanceRequest, binding: ActionBinding, token?: string): AuthorityRequest {
  if (request.proposedAction !== binding.action || request.target !== binding.target) {
    throw new Error('No RC2 action/target binding for this request');
  }
  return {
    tool: binding.tool, args: structuredClone(binding.args), speaker_id: request.agent,
    channel_id: binding.channelId, scene_id: binding.sceneId,
    session_id: request.provenance.scenarioId,
    ...(token ? { lease_token: token } : {}),
  };
}

export function normalizeDecision(native: NativeDecision): RuntimeDecision['result'] {
  if (native.schema_version !== '1.0' || native.issuer !== 'kingpin') throw new Error('Unsupported RC2 decision contract');
  switch (native.outcome) {
    case 'allow': return 'ALLOW';
    case 'deny': case 'quarantine': return 'DENY';
    // RC2 blocks these pending evidence/review; neither is permission to execute.
    case 'constrain': case 'human_review': return 'INDETERMINATE';
    default: throw new Error(`Unsupported RC2 outcome: ${native.outcome}`);
  }
}

export class KingpinRc2Adapter implements RuntimeAdapter {
  #runtime: Rc2Boundary;
  #turns: CdeTurn[];
  #binding: ActionBinding;
  #original: GovernanceRequest;
  #lease?: Lease;
  #controls: NativeObject[] = [];
  #submitted = new Set<string>();

  constructor(runtime: Rc2Boundary, turns: CdeTurn[], binding: ActionBinding, original: GovernanceRequest) {
    this.#runtime = runtime;
    this.#turns = structuredClone(turns);
    this.#binding = structuredClone(binding);
    this.#original = structuredClone(original);
  }

  async #evaluate(request: GovernanceRequest, input: AuthorityRequest, requestId: string) {
    const turn = this.#turns.shift();
    if (!turn?.governance_signal || !turn.top_event?.event_id) throw new Error('Missing real CDE evaluation');
    const native = await this.#runtime.decide(turn.governance_signal, input, turn.top_event.event_id, {
      request_id: requestId, decision_id: `rc2-${requestId}`, principal_id: request.principal,
    });
    const audit = await this.#runtime.getEventsForRequest(requestId);
    const observed = audit.find(event => event.event_type === 'authority.decision');
    if (!observed || typeof observed.decision_id !== 'string' || observed.request_id !== requestId
        || observed.outcome !== native.outcome || observed.evaluation_id !== native.evaluation_id) {
      throw new Error('RC2 did not emit a correlated authority decision');
    }
    return { native, audit, turn, decisionId: observed.decision_id };
  }

  async inject(control: { type: 'GRANT' | 'REVOKE'; authorityRef: string }): Promise<void> {
    if (control.authorityRef !== this.#original.authorityRef) throw new Error('Unknown RC2 authority reference');
    const input = mapRequest(this.#original, this.#binding, this.#lease?.lease_token);
    const audit = { request_id: `rc2-${control.type.toLowerCase()}`, principal_id: this.#original.principal };
    if (control.type === 'GRANT') {
      if (this.#lease) throw new Error('RC2 fixture authority already initialized');
      // Establish an evaluated context through RC2, then ask RC2 to issue authority.
      // RC2 itself decides whether this trusted fixture setup is permitted.
      const setup = await this.#evaluate(this.#original, { ...input, tool: 'fs.list' }, 'rc2-setup');
      const lease = await this.#runtime.issue({ ...input, seconds: 60 }, audit);
      const check = await this.#runtime.validateLease({ ...input, lease_token: lease.lease_token });
      if (!check.valid || check.reason !== 'ok') throw new Error('RC2 issuance was not observably valid');
      this.#lease = lease;
      const { lease_token: secret, ...publicLease } = lease;
      this.#controls.push({ type: 'GRANT', authorityRef: control.authorityRef, setup,
        lease: publicLease, validation: check, audit: await this.#runtime.getEventsForRequest(audit.request_id) });
    } else {
      if (!this.#lease) throw new Error('No issued RC2 lease to revoke');
      const acknowledgement = await this.#runtime.revokeLeaseNonce(this.#lease.lease_id, audit);
      const check = await this.#runtime.validateLease(input);
      if (acknowledgement.revoked !== true || acknowledgement.lease_nonce !== this.#lease.lease_id
          || check.valid !== false || check.reason !== 'nonce_revoked') {
        throw new Error('RC2 revocation was not observably acknowledged');
      }
      this.#controls.push({ type: 'REVOKE', authorityRef: control.authorityRef, acknowledgement,
        validation: check, audit: await this.#runtime.getEventsForRequest(audit.request_id) });
    }
  }

  async submit(request: GovernanceRequest): Promise<RuntimeDecision> {
    if (this.#submitted.has(request.requestId)) throw new Error('RC2 submission requires a fresh request ID');
    if (request.authorityRef !== this.#original.authorityRef || !this.#lease) throw new Error('Unknown RC2 authority reference');
    if (request.leaseRef !== undefined && request.leaseRef !== this.#lease.lease_id) throw new Error('Unknown RC2 lease reference');
    this.#submitted.add(request.requestId);
    const input = mapRequest(request, this.#binding, this.#lease.lease_token);
    const observation = await this.#evaluate(request, input, request.requestId);
    const check = await this.#runtime.validateLease(input);
    const { lease_token: secret, ...publicInput } = input;
    return {
      decisionId: observation.decisionId, requestId: request.requestId,
      result: normalizeDecision(observation.native), rationale: observation.native.reason,
      authority: { reference: request.authorityRef!, leaseRef: this.#lease.lease_id, state: check.reason },
      evidence: { kingpin_rc2: {
        governance: 'real-rc2', enforcement: 'harness-simulation', execution: 'harness-simulation',
        ...observation, input: publicInput, lease_id: this.#lease.lease_id, lease_validation: check,
        harnessRequest: structuredClone(request), controls: structuredClone(this.#controls),
      } },
    };
  }
}
