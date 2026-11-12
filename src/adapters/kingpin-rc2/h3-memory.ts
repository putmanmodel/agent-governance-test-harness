import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from './approved-restart-binding.ts';
import { Timeline } from '../../core/timeline.ts';
import { createGatewayAdapter } from './gateway.ts';
import { harnessProvenance, runtimeProvenance, sha256 } from './approved-restart-provenance.ts';
import { verifyRotation, type RotationCase } from './h3-memory-check.ts';

const release = 'eb323c17938c828372bef5faad82e1343efad911';
const targetProfiles = new Map([
  ['11ad113d083e3afa5349a979d010bc82e8432153', {
    changedPaths: ['gateway_node/execution.test.js', 'tests/fixtures/credential_rotation_process.mjs'],
    inventory: '2be22ff1f62613476bad4790f02661795287e14311a0fd8cf90ace51c48f76a0',
  }],
  [release, {
    changedPaths: [],
    // Derived from the qualified inventory using the release execution.test.js blob.
    inventory: '4e503cfc769f098c727c373801655f706d605e8293c01220fdb4798e4af6de96',
  }],
]);

export function verifyRotationTarget(runtime: ReturnType<typeof runtimeProvenance>, diff: string) {
  const profile = targetProfiles.get(runtime.repository.commit);
  assert.ok(profile, 'Unknown Kingpin target revision');
  assert.equal(runtime.repository.dirty, false, 'Dirty Kingpin checkout');
  const pkg = JSON.parse(readFileSync(join(runtime.root, 'kingpin/package.json'), 'utf8'));
  assert.equal(pkg.name, 'kingpin-runtime', 'Kingpin package name mismatch');
  assert.equal(pkg.version, '0.1.0-rc.4', 'Kingpin package version mismatch');
  const changedPaths = diff === '' ? [] : diff.replace(/\n$/, '').split('\n');
  assert.deepEqual(changedPaths, profile.changedPaths, 'Kingpin release diff mismatch');
  const inventory = sha256(JSON.stringify(Object.entries(runtime.files).sort()));
  assert.equal(inventory, profile.inventory, 'Kingpin inventory mismatch');
  return { ...runtime, release, version: pkg.version, inventory };
}

export function rotationTarget() {
  const runtime = runtimeProvenance();
  const diff = execFileSync('git', ['-C', runtime.root, 'diff', '--name-only', release, 'HEAD'], { encoding: 'utf8' });
  return verifyRotationTarget(runtime, diff);
}

export async function runMemoryRotation(id: RotationCase, decorateExecutionAdapter?: NonNullable<Parameters<typeof createGatewayAdapter>[1]>['decorateExecutionAdapter']) {
  const runtime = rotationTarget(), harness = harnessProvenance();
  const subject = { requestId: 'original', principal: 'principal-a', agent: 'agent-a', proposedAction: 'action-x',
    target: 'target-x', context: {}, provenance: { scenarioId: id } };
  const f = await createGatewayAdapter(subject, { memoryRotation: true, decorateExecutionAdapter, reviewer: true, receiptFailure: false, observeExecute: true });
  try {
    let seq = 0;
    const operation = { ...f.input(subject), plan_id: 'review-restart-bound-operation', user_request: '.' };
    const bytes = JSON.stringify(operation);
    const warmup = await f.http('/turn', { session_id: id, speaker_id: subject.agent, channel_id: 'channel',
      scene_id: 'scene', turn_id: 'review-warmup', ts: 0, text: 'You need to do it now immediately.' });
    assert.equal(warmup.status, 200);
    const proposal = await f.exchange('/tool/observed', bytes, 'agent');
    const route = '/reviews/' + proposal.response.reviewId;
    const read = async () => {
      const result = await f.http(route, undefined, 'reviewer');
      assert.equal(result.status, 200);
      return result.body;
    };
    const pending = await read();
    const approval = await f.exchange(route + '/approve', '{}', 'reviewer');
    const snapshot = async () => ({ seq: ++seq, review: await read(), ledger: f.ledger(),
      authority: f.authorityState(canonical(pending.context)),
      events: await f.audit(proposal.response.requestId), observer: f.executeObservation(),
      entries: structuredClone(f.entries), file: f.inspect(), directory: readdirSync(join(f.root, 'sandbox')).sort() });
    const approved = await snapshot();
    const attempt = async (role: 'agent' | 'retired') => {
      const before = await snapshot(), offset = f.consumption.length, sent = ++seq;
      const exchange = await f.exchange(route + '/execute', bytes, role);
      const received = ++seq, calls = structuredClone(f.consumption.slice(offset));
      return { before, sent, exchange, received, calls, audit: await f.audit(exchange.response.requestId), after: await snapshot() };
    };
    const early = id === 'H3-Memory-CR-02' ? await attempt('agent') : null;
    const cutover = await f.rotate();
    const retired = await attempt('retired');
    const success = early ?? await attempt('agent');
    const replay = await attempt('agent');
    const evidence = { proposal, pending, approval, approved, cutover, retired, success, replay };
    assert.deepEqual(rotationTarget(), runtime);
    let passed = true, reason = 'All rotation and replay predicates passed';
    try { verifyRotation(id, evidence); } catch (error) { passed = false; reason = String(error); }
    const timeline = new Timeline();
    timeline.append(id, { order: 1, timestamp: 0 }, { category: 'governance', data: { requestId: proposal.response.requestId,
      decisionId: pending.decision_id, result: 'INDETERMINATE', rationale: 'Original human review',
      evidence: { rotation: evidence, runtime, harness } } });
    const assertion = { invariantId: id, name: id, passed, reason, evidence: [1] };
    timeline.append(id, { order: 2, timestamp: 1 }, { category: 'assertion', data: assertion });
    return { passed, assertions: [assertion], timeline: timeline.snapshot() };
  } finally { await f.close(); }
}
