// Local descriptions of the public RC2 module boundary, not authority rules.
export type NativeObject = Record<string, unknown>;
export interface AuthorityRequest {
  tool: string;
  args: NativeObject;
  speaker_id: string;
  channel_id: string;
  session_id: string;
  scene_id: string;
  lease_token?: string;
}
export interface AuditContext { request_id: string; decision_id?: string; principal_id: string }
export interface NativeDecision extends NativeObject {
  schema_version: string;
  issuer: string;
  outcome: string;
  reason: string;
  evaluation_id: string;
}
export interface Lease extends NativeObject { lease_token: string; lease_id: string }
export interface LeaseCheck { valid: boolean; reason: string }
export interface Revocation { revoked: boolean; lease_nonce: string }
export interface CdeTurn extends NativeObject {
  governance_signal: NativeObject;
  top_event: { event_id: string };
}
type Awaitable<T> = T | Promise<T>;
export interface Rc2Boundary {
  decide(signal: NativeObject, request: AuthorityRequest, evaluationId: string, audit: AuditContext): Awaitable<NativeDecision>;
  issue(request: AuthorityRequest & { seconds: number }, audit: AuditContext): Awaitable<Lease>;
  revokeLeaseNonce(nonce: string, audit: AuditContext): Awaitable<Revocation>;
  validateLease(request: AuthorityRequest): Awaitable<LeaseCheck>;
  getEventsForRequest(requestId: string): Awaitable<NativeObject[]>;
}

export interface ActionBinding {
  action: string;
  target: string;
  tool: string;
  args: NativeObject;
  channelId: string;
  sceneId: string;
}
