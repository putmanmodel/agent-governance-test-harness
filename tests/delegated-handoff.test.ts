import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delegatedHandoff, originatingRequest, delegatedRequest } from '../scenarios/delegated-handoff.ts';
import { delegatedHandoffInvariant, type HandoffEvidence } from '../src/adapters/kingpin-rc2/handoff-assertion.ts';
import type { RuntimeAdapter } from '../src/core/runtime-adapter.ts';
import { runScenario } from '../src/core/runner.ts';
import { translateEffects } from '../src/adapters/kingpin-rc2/gateway.ts';

function scriptedBoundary(copyAuthority: boolean): RuntimeAdapter {
  const receipt = { execution_id: 'execution-a', status: 'succeeded', principal_id: 'principal-a', agent_id: 'agent-a',
    request_id: 'native-a', decision_id: 'decision-a' };
  const file = { exists: true, content: 'deterministic governance fixture\n' };
  return { async inject() { throw new Error('No authority handoff'); }, async submit(request) {
    const b = request.agent === 'agent-b';
    const nativeId = b ? 'native-b' : 'native-a';
    const decisionId = b && !copyAuthority ? 'decision-b' : 'decision-a';
    const evaluationId = b && !copyAuthority ? 'evaluation-b' : 'evaluation-a';
    const event = (event_type: string) => ({ event_type, principal_id: request.principal, agent_id: request.agent,
      request_id: nativeId, decision_id: decisionId, evaluation_id: evaluationId, outcome: b && !copyAuthority ? 'deny' : 'allow' });
    const execution = b ? { ...receipt, execution_id: 'forbidden-b', request_id: nativeId, principal_id: request.principal, agent_id: request.agent } : receipt;
    const audit = b && copyAuthority ? [] : [event('cde.signal.created'), event('authority.decision')];
    audit.push(event(b && !copyAuthority ? 'tool.enforcement.denied' : 'tool.enforcement.allowed'));
    if (!b || copyAuthority) audit.push(event('tool.execution.started'), event('tool.execution.succeeded'));
    const evidence: HandoffEvidence = {
      sources: {}, harnessRequest: request,
      input: { tool: 'fs.write', args: { path: 'effect.txt', content: file.content },
        ...(b ? { harness_provenance: request.context.handoff } : {}) },
      response: { status: b && !copyAuthority ? 403 : 200, requestId: nativeId,
        body: { authority_decision: { outcome: b && !copyAuthority ? 'deny' : 'allow', evaluation_id: evaluationId } } },
      audit, setup: { requestId: 'setup-b', acknowledgement: { revoked: true, target: { tool: 'fs.write' }, context: { speaker_id: 'agent-b' } },
        audit: [{ event_type: 'capability.revoked', agent_id: 'agent-b' }] },
      ledgerBefore: b ? [receipt] : [], ledgerAfter: b && copyAuthority ? [receipt, execution] : [receipt],
      fileBefore: b ? file : { exists: false }, fileAfter: file, receipt: b && !copyAuthority ? null : execution,
    };
    return { requestId: request.requestId, decisionId, result: b && !copyAuthority ? 'DENY' : 'ALLOW',
      rationale: 'Scripted boundary observation; no policy evaluation.', evidence: { rc2_handoff: evidence } };
  } };
}
async function run(copyAuthority: boolean) {
  return runScenario(delegatedHandoff, scriptedBoundary(copyAuthority), async (request, decision) => {
    const e = decision.evidence.rc2_handoff as HandoffEvidence;
    return translateEffects(request.requestId, { ...e, nativeRequestId: e.response.requestId });
  });
}

test('handoff assertion requires distinct authenticated identities, fresh evaluation and accounting', async () => {
  const result = await run(false);
  assert.equal(result.passed, true);
  const records = structuredClone(result.timeline);
  const b = records.find(r => r.category === 'governance' && r.data.requestId === delegatedRequest.requestId);
  assert.ok(b?.category === 'governance');
  const evidence = b.data.evidence.rc2_handoff as HandoffEvidence;
  evidence.audit.find(e => e.event_type === 'authority.decision')!.principal_id = originatingRequest.principal;
  assert.equal(delegatedHandoffInvariant(records).passed, false, 'labeling an A-authenticated call as B must fail');
  assert.equal(delegatedHandoffInvariant([]).passed, false);
});

test('broken boundary copying A authority and executing B without fresh governance fails', async () => {
  const result = await run(true);
  assert.equal(result.passed, false);
  assert.ok(result.timeline.some(r => r.category === 'execution' && r.data.requestId === delegatedRequest.requestId && r.data.status === 'SUCCEEDED'));
});
