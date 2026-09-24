import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stageRequest, stagedWrite, deferredRecord, stagedContent } from '../../../scenarios/staged-write-after-revocation.ts';
import { createGatewayAdapter, translateEffects } from './gateway.ts';
import { normalizeDecision } from './adapter.ts';
import { runScenario } from '../../core/runner.ts';
import type { RuntimeAdapter } from '../../core/runtime-adapter.ts';

export async function runStagedWrite() {
  const f = await createGatewayAdapter(stageRequest, { receiptFailure: false });
  try {
    const sequence = () => {
      const db = new DatabaseSync(join(f.root, 'state.sqlite'), { readOnly: true });
      try { return db.prepare('SELECT sequence, record FROM governance_events ORDER BY sequence').all()
        .map(r => ({ sequence: Number(r.sequence), record: JSON.parse(String(r.record)) })); }
      finally { db.close(); }
    };
    const files = () => ({ target: f.inspect(), stage: existsSync(join(f.root, 'sandbox/staged.json'))
      ? readFileSync(join(f.root, 'sandbox/staged.json'), 'utf8') : null });
    let origin: any, revocation: any;
    const exchanges: string[] = [];
    const runtime: RuntimeAdapter = {
      async inject(control) {
        if (!origin || control.type !== 'REVOKE' || control.authorityRef !== 'write-capability') throw new Error('Invalid staged control');
        exchanges.push('revoke-request');
        const input = f.input(stageRequest);
        const response = await f.http('/revoke', input, 'admin');
        const audit = await f.audit(response.requestId);
        if (response.status !== 200 || response.body.revoked !== true || !audit.some(e => e.event_type === 'capability.revoked')) throw new Error('Revocation not acknowledged');
        exchanges.push('revoke-acknowledged');
        revocation = { input, response, audit };
      },
      async submit(request) {
        const stage = request.requestId === 'stage-create';
        if (!stage && (request.requestId !== 'stage-due' || !revocation)) throw new Error('Invalid deferred boundary');
        const input: any = { ...f.input(request), args: stage ? { path: 'staged.json', content: stagedContent } : f.input(request).args,
          harness_provenance: { ...deferredRecord, ...(stage ? {} : origin) } };
        const before = { ledger: f.ledger(), files: files() };
        exchanges.push(stage ? 'stage-request' : 'due-request');
        const response = await f.http('/tool/observed', input);
        const audit = await f.audit(response.requestId);
        const decision = audit.find(e => e.event_type === 'authority.decision');
        if (!decision || !response.body.authority_decision) throw new Error('Missing native decision');
        const receipt = response.body.execution_id ? await f.readExecutionReceipt(response.body.execution_id) : null;
        if (stage) origin = { native_request_id: response.requestId, decision_id: decision.decision_id, evaluation_id: decision.evaluation_id };
        exchanges.push(stage ? 'stage-observed' : 'due-observed');
        return { requestId: request.requestId, decisionId: decision.decision_id, result: normalizeDecision(response.body.authority_decision),
          rationale: response.body.authority_decision.reason, evidence: { rc2_staged: {
            source: { deferral: 'harness', governance: 'rc2', execution: 'rc2' }, deferredContract: null,
            request, input, response, audit, receipt, before, after: { ledger: f.ledger(), files: files() },
            origin: structuredClone(origin), revocation, exchanges: [...exchanges], nativeSequence: sequence(),
          } } };
      },
    };
    return await runScenario(stagedWrite, runtime, async (request, decision) => {
      const e = decision.evidence.rc2_staged as any;
      return translateEffects(request.requestId, { nativeRequestId: e.response.requestId, audit: e.audit,
        ledgerBefore: e.before.ledger, ledgerAfter: e.after.ledger, fileBefore: e.before.files.target, fileAfter: e.after.files.target });
    });
  } finally { await f.close(); }
}
