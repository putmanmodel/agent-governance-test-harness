import { createGatewayAdapter } from './gateway.ts';
import { approvedRestartRequest as reviewRestartRequest } from '../../../scenarios/approved-review-revocation-survives-restart.ts';
import { approvedSnapshot } from './approved-restart-snapshot.ts';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rc2Root } from './load.ts';
import { runtimeProvenance } from './approved-restart-provenance.ts';
const [root, mode] = process.argv.slice(2);
const runtime = runtimeProvenance();
const nativeReview = await import(pathToFileURL(join(rc2Root, 'kingpin/review/model.js')).href);
const nativeAudit = await import(pathToFileURL(join(rc2Root, 'kingpin/audit/events.js')).href);
const nativeExecution = await import(pathToFileURL(join(rc2Root, 'kingpin/execution/model.js')).href);
function journal(record: object) {
  const fd = openSync(join(root, 'observer.jsonl'), 'a', 0o600);
  try { writeSync(fd, JSON.stringify({ pid: process.pid, ...record }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
const f = await createGatewayAdapter(reviewRestartRequest, { reviewer: true, receiptFailure: false, persistent: { root, create: mode === 'create' },
  beforeEffect(request) {
    journal({ type: 'execute', request });
  } });
const body = { ...f.input(reviewRestartRequest), plan_id: 'review-restart-bound-operation', user_request: '.' };
journal({ type: 'ready', mode, hook: 'beforeEffect' });
const snapshot = () => {
  const s = approvedSnapshot(root);
  s.reviews.forEach(nativeReview.validateReview);
  s.events.forEach(({ sequence, ...event }) => nativeAudit.validateEvent(event));
  s.ledger.forEach(nativeExecution.validateExecution);
  return s;
};
process.send!({ type: 'ready', pid: process.pid, mode, runtime, nativeBinding: nativeReview.requestBinding(body, reviewRestartRequest.principal), snapshot: snapshot(), identity: {
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
      nativeReview.validateReviewTransition(pending.body, approval.body.review);
      const approved = snapshot();
      const revoke = await f.http('/revoke', body, 'admin');
      const revocationAudit = await f.audit(revoke.requestId);
      const review = await f.http(`/reviews/${held.reviewId}`, undefined, 'reviewer');
      process.send!({ type: 'lifecycle', pid: process.pid, body, held, pending, approval, approved, revoke, revocationAudit, review,
        audit: await f.audit(held.requestId), before, after: snapshot() });
    } else if (message.type === 'replay') {
      const before = snapshot();
      const inspected = await f.http(`/reviews/${message.reviewId}`, undefined, 'reviewer');
      const path = `/reviews/${message.reviewId}/execute`;
      const response = await f.http(path, body);
      const review = await f.http(`/reviews/${message.reviewId}`, undefined, 'reviewer');
      nativeReview.validateReviewTransition(inspected.body, review.body);
      process.send!({ type: 'replay', pid: process.pid, nativeBinding: nativeReview.requestBinding(body, reviewRestartRequest.principal), path, body, inspected, response, review,
        audit: await f.audit(response.requestId), originalAudit: await f.audit(inspected.body.request_id),
        receipt: response.body.execution_id ? await f.readExecutionReceipt(response.body.execution_id) : null, before, after: snapshot() });
    } else if (message.type === 'close') { await f.close(); await new Promise<void>((resolve, reject) => process.send!({ type: 'closed', runtime: runtimeProvenance() }, error => error ? reject(error) : resolve())); process.disconnect(); }
    else throw new Error('Unknown review restart command');
  } catch (error) { process.send!({ type: message.type, error: String(error) }); await f.close(); process.exitCode = 1; process.disconnect(); }
});
