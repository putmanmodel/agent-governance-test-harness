import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createGatewayAdapter } from './gateway.ts';
import { restartRequest } from '../../../scenarios/capability-revocation-survives-restart.ts';
const [root, mode] = process.argv.slice(2);
const f = await createGatewayAdapter(restartRequest, { receiptFailure: false, persistent: { root, create: mode === 'create' } });
function snapshot() {
  const filename = join(root, 'state.sqlite'), stat = statSync(filename), sandbox = statSync(join(root, 'sandbox'));
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return { database: { dev: stat.dev, ino: stat.ino }, sandbox: { dev: sandbox.dev, ino: sandbox.ino },
    metadata: db.prepare('SELECT * FROM store_metadata').all(),
    revocations: db.prepare('SELECT * FROM capability_revocations ORDER BY context_key, tool').all(),
    events: db.prepare('SELECT sequence, record FROM governance_events ORDER BY sequence').all().map(r => ({ sequence: Number(r.sequence), record: JSON.parse(String(r.record)) })),
    ledger: f.ledger(), file: f.inspect() }; }
  finally { db.close(); }
}
process.send!({ type: 'ready', pid: process.pid, mode, snapshot: snapshot(), identity: { principal: restartRequest.principal, agent: restartRequest.agent, context: f.input(restartRequest) } });
process.on('message', async (message: any) => {
  try {
    if (message.type === 'submit') {
      const before = snapshot(), input = f.input(message.request);
      const response = await f.http('/tool/observed', input), audit = await f.audit(response.requestId);
      const receipt = response.body.execution_id ? await f.readExecutionReceipt(response.body.execution_id) : null;
      process.send!({ type: 'submit', pid: process.pid, input, request: message.request, response, audit, receipt, before, after: snapshot() });
    } else if (message.type === 'revoke') {
      const input = f.input(restartRequest), response = await f.http('/revoke', input, 'admin'), audit = await f.audit(response.requestId);
      if (response.status !== 200 || response.body.revoked !== true) throw new Error('Revocation not acknowledged');
      process.send!({ type: 'revoke', pid: process.pid, input, response, audit, snapshot: snapshot() });
    } else if (message.type === 'close') {
      await f.close(); process.disconnect();
    } else throw new Error('Unknown restart child command');
  } catch (error) {
    process.send!({ type: message.type, error: String(error) });
    await f.close(); process.exitCode = 1; process.disconnect();
  }
});
