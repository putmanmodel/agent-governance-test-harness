import { createInterface } from 'node:readline';

// Independent single-authority reference runtime; not production policy.
let valid = false;
let evaluation = 0;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const message = JSON.parse(line);
    if (message.protocol_version !== '1' || typeof message.id !== 'string') throw new Error('Invalid protocol envelope');
    const envelope = { protocol_version: '1', id: message.id };
    if (message.op === 'inject') {
      if (message.authority_ref !== 'authority-1' || !['GRANT', 'REVOKE'].includes(message.type)) throw new Error('Unknown control');
      valid = message.type === 'GRANT';
      console.log(JSON.stringify({ ...envelope, kind: 'ack', applied: true, type: message.type, authority_ref: message.authority_ref }));
    } else if (message.op === 'submit') {
      const request = message.request;
      if (!request || typeof request.request_id !== 'string') throw new Error('Invalid request');
      const allowed = valid && request.authority_ref === 'authority-1';
      evaluation++;
      console.log(JSON.stringify({ ...envelope, kind: 'decision', request_id: request.request_id,
        decision_id: `reference-decision-${evaluation}`, evaluation_id: `reference-evaluation-${evaluation}`,
        outcome: allowed ? 'allow' : 'deny', reason: allowed ? 'Current authority is valid.' : 'Current authority is absent or revoked.',
        authority_ref: request.authority_ref, evidence: { authority_valid: valid, principal_id: request.principal_id,
          agent_id: request.agent_id, provenance: request.provenance } }));
    } else throw new Error('Unknown operation');
  } catch (error) { console.error(String(error)); process.exitCode = 1; break; }
}
