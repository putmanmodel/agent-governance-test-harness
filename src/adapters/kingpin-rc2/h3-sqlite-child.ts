import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from './approved-restart-binding.ts';
import { createGatewayAdapter } from './gateway.ts';
import { appendObservation, durableSnapshot, journal } from './h3-sqlite-snapshot.ts';
import { rotationTarget } from './h3-memory.ts';

const [root, mode, id] = process.argv.slice(2);
const phase = mode === 'create' ? 'A' : 'B';
let fixture: Awaited<ReturnType<typeof createGatewayAdapter>>;
const runtime = rotationTarget();
type Native = Record<string, any>;

async function run(message: Native) {
  const subject = { requestId: 'original', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x',
    target: 'target-x', context: {}, provenance: { scenarioId: id } };
  const scoped = id === 'H4-SQLite-CR-04';
  let detector: Native | undefined;
  fixture = await createGatewayAdapter(subject, { reviewer: true, receiptFailure: false, observeExecute: true,
    agentChannels: scoped ? (phase === 'A' || message.omitChange ? ['channel','retained'] : ['retained']) : undefined,
    detectorInput: () => detector,
    persistent: { root, create: phase === 'A' }, restartRotation: { phase, agent: message.credentials.agent, retired: message.credentials.retired,
      reviewer: message.credentials.reviewer, tagKey: message.credentials.tagKey,
      record(entry) {
        const sequence = journal(root).filter(row => row.type === 'execute').length + 1;
        appendObservation(root, { ...entry, type: 'execute', pid: process.pid, sequence });
      } } });
  const f = fixture;
  appendObservation(root, { type: 'ready', phase, pid: process.pid });
  const opened = durableSnapshot(root);
  let seq = message.seq, anchor = message.anchor;
  let proposal, pending, approval;
  if (phase === 'A') {
    const warmup = await f.http('/turn', { session_id: id, speaker_id: subject.agent, channel_id: 'channel',
      scene_id: 'scene', turn_id: 'review-warmup', ts: 0, text: 'You need to do it now immediately.' });
    assert.equal(warmup.status, 200);
    const bytes = JSON.stringify({ ...f.input(subject), plan_id: 'review-restart-bound-operation', user_request: '.' });
    proposal = await f.exchange('/tool/observed', bytes, 'agent');
    const route = '/reviews/' + proposal.response.reviewId;
    const read = await f.http(route, undefined, 'reviewer');
    assert.equal(read.status, 200);
    pending = read.body;
    approval = await f.exchange(route + '/approve', '{}', 'reviewer');
    anchor = { route, bytes, context: pending.context, requestId: proposal.response.requestId };
  }
  const snapshot = async () => {
    const read = await f.http(anchor.route, undefined, 'reviewer');
    assert.equal(read.status, 200);
    const records = journal(root), entries = records.filter(row => row.type === 'execute');
    const attached = f.executeObservation();
    assert.deepEqual(attached.calls, entries.filter(row => row.pid === process.pid).map(row => row.operation));
    return { seq: ++seq, review: read.body, ledger: f.ledger(), authority: f.authorityState(canonical(anchor.context)),
      events: await f.audit(anchor.requestId), entries, file: f.inspect(), directory: readdirSync(join(root, 'sandbox')).sort(),
      observer: { ready: attached.ready && records.some(row => row.type === 'ready' && row.pid === process.pid),
        calls: entries.map(row => row.operation) } };
  };
  const attempt = async (role: 'agent' | 'retired') => {
    const before = await snapshot(), offset = f.consumption.length, sent = ++seq;
    const exchange = await f.exchange(anchor.route + '/execute', anchor.bytes, role);
    const received = ++seq, calls = structuredClone(f.consumption.slice(offset));
    return { before, sent, exchange, received, calls, audit: await f.audit(exchange.response.requestId), after: await snapshot() };
  };
  const approved = phase === 'A' ? await snapshot() : undefined;
  if (id.startsWith('H4-')) {
    let change, control, retired, refusal;
    if (phase === 'A' && !scoped && !message.omitChange) {
      if (id.endsWith('06')) {
        detector = { top_event: { event_id: crypto.randomUUID() }, governance_signal: {
          schema_version: '1.0', scope_key: 'scene:scene', gate: 2, gate_label: 'LEASE REQUIRED',
          evidence_requirements: [], reason_codes: ['LEASE_THRESHOLD_REACHED'],
          authority: { requirement: 'lease', recommendation: 'request_external_lease' },
          deviation: { severity: .8, ema_severity: .7, confidence: .9, active: true, enter: false, exit: false, vector: {} },
        } };
      }
      const exchange = id.endsWith('05') ? await f.exchange('/revoke', anchor.bytes, 'admin')
        : await f.exchange('/tool', anchor.bytes, 'agent');
      change = { exchange, detector, audit: await f.audit(exchange.response.requestId) };
    }
    if (phase === 'B') {
      retired = await attempt('retired');
      if (scoped) control = await f.exchange('/turn', JSON.stringify({ session_id: id, speaker_id: subject.agent,
        scene_id: 'scene', channel_id: 'retained', turn_id: 'positive-scope-control', ts: 0, text: '.' }), 'agent');
      refusal = await attempt('agent');
    }
    const closing = durableSnapshot(root);
    await f.close();
    assert.deepEqual(rotationTarget(), runtime);
    return { pid: process.pid, opened, closing, seq, anchor, proposal, pending, approval, approved, change, control, retired, refusal };
  }
  const retired = phase === 'B' ? await attempt('retired') : undefined;
  const success = (phase === 'B') === id.endsWith('01') ? await attempt('agent') : undefined;
  const replay = phase === 'B' ? await attempt('agent') : undefined;
  const closing = durableSnapshot(root);
  await f.close();
  assert.deepEqual(rotationTarget(), runtime);
  return { opened, closing, pid: process.pid, seq, anchor, proposal, pending, approval, approved, retired, success, replay };
}
process.on('message', async (message: Native) => {
  if (message.type === 'close') { process.disconnect(); return; }
  try { process.send!({ type: message.type, ...await run(message) }); }
  catch (error) { await fixture?.close(); process.send!({ type: message.type, error: String(error) }); }
});
