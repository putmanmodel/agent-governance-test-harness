import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import type { Invariant } from '../../core/assertions.ts';
export const unknownRestartInvariant: Invariant = timeline => {
  const record = timeline.find(r => r.category === 'governance');
  const e = record?.category === 'governance' ? record.data.evidence.rc2_unknown_restart as any : undefined;
  const result = (passed: boolean) => ({ invariantId: 'unknown_execution_survives_restart_without_redispatch',
    name: 'UNKNOWN execution survives restart without redispatch', passed,
    reason: passed ? 'Native recovery preserved execution identity, classified UNKNOWN and reconciled physical evidence without redispatch.'
      : 'Missing or inconsistent crash, ownership, durable execution, reconciliation or no-redispatch evidence.', evidence: record ? [record.sequence] : [] });
  try {
    const { a, b, atBoundary: at, afterDeath: dead } = e;
    // Existing version-1 artifacts without a case label are the original after-effect experiment.
    const crashCase = e.crashCase ?? 'after-effect', beforeEffect = crashCase === 'before-effect';
    const original = dead.ledger[0], final = b.snapshot.ledger[0];
    const matching = (x: any) => ['execution_id','request_id','decision_id','evaluation_id'].every(k => x[k] === original[k]);
    const originalEvents = dead.events.filter((x: any) => x.request_id === original.request_id);
    const ordered = ['cde.signal.created','authority.decision','tool.enforcement.allowed','tool.execution.started'];
    const indices = ordered.map(type => originalEvents.findIndex((x: any) => x.event_type === type));
    const authority = originalEvents.find((x: any) => x.event_type === 'authority.decision');
    const recovery = b.snapshot.events.slice(dead.events.length);
    const callsA = dead.calls, callsB = b.snapshot.calls.slice(callsA.length);
    const disposition: Record<string, string> = { succeeded: 'reconciled_succeeded', failed: 'reconciled_failed',
      inconclusive: 'reconciliation_required', unsupported: 'reconciliation_required' };
    const stable = (x: any) => { const copy = { ...x }; for (const k of ['status','failure_code','completed_at','reconciliation']) delete copy[k]; return copy; };
    const passed = record?.category === 'governance' && record.data.result === 'ALLOW' && record.data.decisionId === original.decision_id
      && timeline.filter(r => r.category === 'governance').length === 1
      && a.mode === 'create' && b.mode === 'reopen' && a.pid > 0 && b.pid > 0 && a.pid !== b.pid
      && ['before-effect','after-effect'].includes(crashCase)
      && e.boundary.pid === a.pid
      && (beforeEffect ? e.boundary.source === 'harness:before-native-execute' && same(e.boundary.request,callsA[0].request)
        : e.boundary.source === 'harness:uncommitted-terminal-append' && matching(e.boundary.event) && e.boundary.event.event_type === 'tool.execution.succeeded')
      && e.exitA.pid === a.pid && e.exitA.code === null && e.exitA.signal === 'SIGKILL'
      && e.exitB.pid === b.pid && e.exitB.code === 0 && e.exitB.signal === null
      && same(e.trace, ['A-spawn','A-ready',`${crashCase}-boundary`,'A-SIGKILL-exited','durable-state-inspected','ownership-released','B-spawn','B-native-recovery-complete','B-exited'])
      && e.ownedA.acquired === false && e.released.acquired === true && e.ownedB.acquired === false
      && e.ownedA.inode === e.released.inode && e.released.inode === e.ownedB.inode
      && a.ownership === 'native-cde-exclusive-lock-acquired' && b.ownership === a.ownership
      && same(a.build,b.build) && same(a.snapshot.database,dead.database) && same(a.snapshot.sandbox,dead.sandbox)
      && same(a.snapshot.metadata,dead.metadata) && same(dead,b.before)
      && same(dead.database,b.snapshot.database) && same(dead.sandbox,b.snapshot.sandbox) && same(dead.metadata,b.snapshot.metadata)
      && a.snapshot.ledger.length === 0 && !a.snapshot.file.exists && a.snapshot.calls.length === 0
      && same(at,dead) && dead.ledger.length === 1 && original.status === 'started' && original.completed_at === null
      && indices.every((n: number,i: number) => n >= 0 && (!i || n > indices[i-1]))
      && ['execution_id','request_id','decision_id','evaluation_id'].every(k => typeof original[k] === 'string' && original[k].length > 0)
      && authority.outcome === 'allow' && authority.decision_id === original.decision_id && authority.evaluation_id === original.evaluation_id
      && originalEvents.filter((x: any) => ['authority.decision','cde.signal.created','tool.enforcement.allowed'].includes(x.event_type))
        .every((x: any) => x.evaluation_id === original.evaluation_id)
      && originalEvents.filter((x: any) => x.event_type.startsWith('tool.execution.')).length === 1
      && matching(originalEvents[indices[3]])
      && (beforeEffect ? same(dead.file,{ source: 'harness', exists: false })
        : dead.file.exists && dead.file.content === 'deterministic governance fixture\n') && same(dead.file,b.snapshot.file)
      && (beforeEffect ? final.status === 'reconciled_failed'
        : ['reconciled_succeeded','reconciliation_required'].includes(final.status))
      && b.recovered === 1 && b.snapshot.ledger.length === 1 && matching(final) && same(stable(original),stable(final))
      && same(b.snapshot.events.slice(0,dead.events.length),dead.events)
      && recovery.length === 2 && recovery.every(matching)
      && recovery[0].event_type === 'tool.execution.unknown' && same(recovery[0].reason_codes,['RUNTIME_DISAPPEARED']) && final.failure_code === 'RUNTIME_DISAPPEARED'
      && recovery[1].event_type === `tool.execution.${final.status}`
      && same(recovery[1].reconciliation,final.reconciliation) && recovery[1].outcome === final.status
      && recovery.every((x: any,i: number) => x.sequence === dead.events.at(-1).sequence + i + 1)
      && final.reconciliation?.method === 'adapter' && final.status === disposition[final.reconciliation.outcome]
      && callsA.length === 1 && callsA[0].pid === a.pid && callsA[0].method === 'execute'
      && callsA[0].source === 'harness:sandbox-call-observation' && callsA[0].request.tool === 'fs.write'
      && callsA[0].request.plan_id === record.data.requestId
      && callsA[0].request.args.content === 'deterministic governance fixture\n'
      && same(b.snapshot.calls.slice(0,callsA.length),callsA)
      && callsB.length === 1 && callsB[0].pid === b.pid && callsB[0].method === 'reconcile'
      && callsB[0].source === 'harness:sandbox-call-observation'
      && same(callsB[0].evidence,original.reconciliation_data) && original.reconciliation_data !== null
      && callsB[0].outcome === final.reconciliation.outcome
      && original.reconciliation_data.expected_hash === createHash('sha256').update(callsA[0].request.args.content).digest('hex')
      && original.reconciliation_data.before.exists === false
      && original.reconciliation_data.root_ino === dead.sandbox.ino && original.reconciliation_data.root_dev === dead.sandbox.dev
      && original.reconciliation_data.path === callsA[0].request.args.path
      && original.agent_id === callsA[0].request.speaker_id && original.principal_id === authority.principal_id
      && original.context.session_id === callsA[0].request.session_id
      && same(timeline.filter(r => r.category === 'execution').map(r => r.data.status),
        ['STARTED','UNKNOWN', ...(final.status === 'reconciled_succeeded' ? ['SUCCEEDED'] : final.status === 'reconciled_failed' ? ['FAILED'] : [])]);
    return result(!!passed);
  } catch { return result(false); }
};
