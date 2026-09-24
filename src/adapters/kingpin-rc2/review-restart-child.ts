import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createGatewayAdapter } from './gateway.ts';
import { reviewRestartRequest } from '../../../scenarios/human-approval-consumption-survives-restart.ts';
const [root, mode] = process.argv.slice(2);
const f = await createGatewayAdapter(reviewRestartRequest, { reviewer: true, receiptFailure: false, persistent: { root, create: mode === 'create' } });
const body = { ...f.input(reviewRestartRequest), plan_id: 'review-restart-bound-operation', user_request: '.' };
function snapshot() {
  const filename = join(root, 'state.sqlite'), db = new DatabaseSync(filename, { readOnly: true });
  const identity = (path: string) => { const s = statSync(path); return { dev: s.dev, ino: s.ino }; };
  try { return { database: identity(filename), sandbox: identity(join(root, 'sandbox')),
    metadata: db.prepare('SELECT * FROM store_metadata').all(),
    reviews: db.prepare('SELECT record FROM reviews ORDER BY review_id').all().map(r => JSON.parse(String(r.record))),
    events: db.prepare('SELECT sequence, record FROM governance_events ORDER BY sequence').all().map(r => ({ sequence: Number(r.sequence), record: JSON.parse(String(r.record)) })),
    ledger: f.ledger(), file: f.inspect() }; } finally { db.close(); }
}
process.send!({ type: 'ready', pid: process.pid, mode, snapshot: snapshot(), identity: {
  principal: reviewRestartRequest.principal, agent: reviewRestartRequest.agent, reviewer: 'harness-reviewer', body,
} });
process.on('message', async (message: any) => {
  try {
    if (message.type === 'lifecycle') {
      const warmup = await f.http('/turn', { session_id: body.session_id, speaker_id: body.speaker_id,
        channel_id: body.channel_id, scene_id: body.scene_id, turn_id: 'review-warmup', ts: 0, text: 'You need to do it now immediately.' });
      if (warmup.status !== 200) throw new Error('CDE warmup failed');
      const before = snapshot();
      const held = await f.http('/tool/observed', body);
      if (!held.reviewId) throw new Error('Native review missing');
      const pending = await f.http(`/reviews/${held.reviewId}`, undefined, 'reviewer');
      const approval = await f.http(`/reviews/${held.reviewId}/approve`, {}, 'reviewer');
      const consumed = await f.http(`/reviews/${held.reviewId}/execute`, body);
      const receipt = consumed.body.execution_id ? await f.readExecutionReceipt(consumed.body.execution_id) : null;
      const review = await f.http(`/reviews/${held.reviewId}`, undefined, 'reviewer');
      process.send!({ type: 'lifecycle', pid: process.pid, body, held, pending, approval, consumed, receipt, review,
        audit: await f.audit(held.requestId), before, after: snapshot() });
    } else if (message.type === 'replay') {
      const before = snapshot();
      const inspected = await f.http(`/reviews/${message.reviewId}`, undefined, 'reviewer');
      const path = `/reviews/${message.reviewId}/execute`;
      const response = await f.http(path, body);
      const review = await f.http(`/reviews/${message.reviewId}`, undefined, 'reviewer');
      process.send!({ type: 'replay', pid: process.pid, path, body, inspected, response, review,
        audit: await f.audit(response.requestId), before, after: snapshot() });
    } else if (message.type === 'close') { await f.close(); process.disconnect(); }
    else throw new Error('Unknown review restart command');
  } catch (error) { process.send!({ type: message.type, error: String(error) }); await f.close(); process.exitCode = 1; process.disconnect(); }
});
