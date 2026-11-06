import { createHash } from 'node:crypto';
// Portable verifier of Kingpin requestBinding/canonical semantics. The live child
// independently computes with the loaded native module; integration checks parity.
export const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
export const bindingHash = (value: any) => createHash('sha256').update(canonical(value ?? {})).digest('hex');
export function requestBinding(request: any, principalId: string) {
  return { principal_id: principalId, agent_id: request.agent_id ?? request.speaker_id,
    speaker_id: request.speaker_id, session_id: request.session_id ?? 'default', channel_id: request.channel_id,
    scene_id: request.scene_id ?? null, task_id: request.task_id ?? null, tool_id: request.tool,
    arguments_hash: bindingHash(request.args ?? {}), action_hash: bindingHash([request.action ?? null, request.tool_action ?? null]),
    target_hash: bindingHash([request.target ?? null, request.tool_target ?? null]),
    observation_hash: bindingHash([request.plan_id ?? null, request.user_request ?? null]),
    dry_run: request.dry_run === true, diff_present: request.diff != null && Boolean(String(request.diff).trim()),
    diff_hash: bindingHash(request.diff ?? null), lease_present: Boolean(request.lease_token),
    lease_nonce: request.lease_token ? (typeof request.lease_token === 'string'
      ? createHash('sha256').update(request.lease_token).digest('hex') : bindingHash(request.lease_token)) : null };
}
export function expectedApprovedBody(scenarioId: string) {
  return { session_id: scenarioId, channel_id: 'channel', scene_id: 'scene', task_id: null, speaker_id: 'agent-a', tool: 'fs.write',
    args: { path: 'effect.txt', content: 'deterministic governance fixture\n' }, plan_id: 'review-restart-bound-operation',
    user_request: '.', dry_run: true, diff: 'create effect.txt' };
}
