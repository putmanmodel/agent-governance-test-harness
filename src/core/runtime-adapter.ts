export interface GovernanceRequest {
  requestId: string;
  principal: string;
  agent: string;
  proposedAction: string;
  target: string;
  authorityRef?: string;
  leaseRef?: string;
  provenance: { scenarioId: string; retryOf?: string };
  context: Record<string, unknown>;
}

export interface RuntimeDecision {
  decisionId: string;
  requestId: string;
  result: 'ALLOW' | 'DENY' | 'INDETERMINATE';
  rationale: string;
  evidence: Record<string, unknown>;
  authority?: { reference: string; state: string; leaseRef?: string };
}

// Acknowledgement means the injected change is observable by subsequent submissions.
export interface RuntimeAdapter {
  inject(control: { type: 'GRANT' | 'REVOKE'; authorityRef: string }): Promise<void>;
  submit(request: GovernanceRequest): Promise<RuntimeDecision>;
}
