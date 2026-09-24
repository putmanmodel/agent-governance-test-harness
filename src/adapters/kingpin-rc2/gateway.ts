import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import type { GovernanceRequest, RuntimeAdapter, RuntimeDecision } from '../../core/runtime-adapter.ts';
import type { ObserveEffects } from '../../core/runner.ts';
import type { ExecutionResult } from '../../core/events.ts';
import type { NativeDecision } from './contracts.ts';
import { normalizeDecision } from './adapter.ts';
import { rc2Root } from './load.ts';

// Rich external records stay isolated here. Native payloads are preserved in evidence.
type RecordData = Record<string, any>;
interface Transaction {
  audit: { append(event: RecordData): unknown };
  executions: { list(): RecordData[] };
}
interface Store {
  transaction<T>(work: (tx: Transaction) => T): T;
  close(): void;
}
export interface GatewayEvidence {
  sources: Record<string, string>;
  native: NativeDecision;
  nativeRequestId: string;
  harnessRequest: GovernanceRequest;
  gateway: { status: number; body: RecordData };
  audit: RecordData[];
  cde: RecordData;
  controls: RecordData[];
  receipt: RecordData | null;
  reconciled: RecordData | null;
  ledgerBefore: RecordData[];
  ledgerAfter: RecordData[];
  fileBefore: RecordData;
  fileAfter: RecordData;
  sandbox: string;
  fault: { source: 'harness'; type: string; injected: boolean };
}

export function translateEffects(requestId: string, evidence: Pick<GatewayEvidence, 'nativeRequestId' | 'audit' | 'ledgerBefore' | 'ledgerAfter' | 'fileBefore' | 'fileAfter'>): Awaited<ReturnType<ObserveEffects>> {
  const events = evidence.audit.filter(e => e.request_id === evidence.nativeRequestId);
  const permitted = events.some(e => e.event_type === 'tool.enforcement.allowed');
  const blocked = events.some(e => e.event_type === 'tool.enforcement.denied');
  if (permitted === blocked) throw new Error('Missing or ambiguous native Gateway enforcement');
  const statuses: Record<string, ExecutionResult['status']> = {
    'tool.execution.started': 'STARTED', 'tool.execution.succeeded': 'SUCCEEDED',
    'tool.execution.failed': 'FAILED', 'tool.execution.unknown': 'UNKNOWN',
    'tool.execution.reconciled_succeeded': 'SUCCEEDED', 'tool.execution.reconciled_failed': 'FAILED',
  };
  const executions = events.filter(e => e.event_type in statuses).map(e => ({ requestId,
    status: statuses[e.event_type], reason: `rc2:execution ${e.event_type}; execution_id=${e.execution_id}` }));
  if (blocked) {
    if (executions.length || evidence.ledgerAfter.some(r => r.request_id === evidence.nativeRequestId)
      || JSON.stringify(evidence.ledgerBefore) !== JSON.stringify(evidence.ledgerAfter)
      || JSON.stringify(evidence.fileBefore) !== JSON.stringify(evidence.fileAfter)) {
      throw new Error('Blocked redispatch changed execution accounting or fixture state');
    }
    executions.push({ requestId, status: 'NOT_STARTED',
      reason: 'rc2:gateway denied; rc2:execution ledger unchanged; harness fixture inspection unchanged.' });
  } else if (!executions.length) throw new Error('Gateway permission has no execution observation');
  return { enforcement: permitted ? 'DISPATCH' : 'BLOCK', executions };
}

export async function createGatewayAdapter(original: GovernanceRequest, options: { receiptFailure?: boolean; reviewer?: boolean; delegatedAgent?: { principal: string; agent: string; sessionId: string } } = {}) {
  const load = (file: string) => import(pathToFileURL(join(rc2Root, file)).href);
  const [kingpin, sqlite, gateway, sandboxModule, executionModule, authModule, cdeModule, config] = await Promise.all([
    load('kingpin/index.js'), load('kingpin/state/sqlite.js'), load('gateway_node/server.js'),
    load('evaluation/sandbox.js'), load('execution/runtime.js'), load('kingpin/auth/access.js'),
    load('evaluation/cde.js'), load('evaluation/config.js'),
  ]);
  const root = mkdtempSync(join(tmpdir(), 'governance-gateway-'));
  const sandbox = join(root, 'sandbox');
  mkdirSync(sandbox, { mode: 0o700 });
  writeFileSync(join(sandbox, 'seed.txt'), 'read-only setup fixture\n', { mode: 0o600 });
  const target = join(sandbox, 'effect.txt');
  let store: Store | undefined;
  let server: Server | undefined;
  let cde: { evaluate(packet: unknown): Promise<unknown>; close(): Promise<unknown> } | undefined;
  const close = async () => {
    try {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        server = undefined;
      }
    } finally {
      try { await cde?.close(); } finally { try { store?.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
    }
  };
  try {
    store = new sqlite.SQLiteStateStore({ filename: join(root, 'state.sqlite'), create: true }) as Store;
    const authority = new kingpin.KingpinAuthority({ store });
    const adapter = sandboxModule.createSandboxAdapter(sandbox);
    // The same transaction-failure injection used by RC2's execution.test.js.
    // The real adapter writes; SQLite rolls back only the terminal receipt, not the file.
    let faultInjected = false;
    const executionStore = { transaction<T>(work: (tx: Transaction) => T): T {
      return store!.transaction(tx => {
        const append = tx.audit.append;
        tx.audit.append = event => {
          const result = append(event);
          if (options.receiptFailure !== false && !faultInjected && event.event_type === 'tool.execution.succeeded') {
            faultInjected = true;
            throw new Error('Harness-injected terminal receipt transaction failure');
          }
          return result;
        };
        return work(tx);
      });
    } };
    const execution = new executionModule.ExecutionRuntime({ store: executionStore, adapter });
    const tokens = { agent: randomBytes(32).toString('base64url'), admin: randomBytes(32).toString('base64url'), reviewer: randomBytes(32).toString('base64url'), delegate: randomBytes(32).toString('base64url') };
    const context = { session_id: original.provenance.scenarioId, channel_id: 'channel', scene_id: 'scene', task_id: null };
    const authentication = authModule.createAuthentication({ schema_version: '1.0', principals: [
      { token: tokens.agent, principal_id: original.principal, role: 'agent', agent_id: original.agent, allowed_contexts: [context] },
      { token: tokens.admin, principal_id: 'harness-admin', role: 'authority_admin' },
      ...(options.delegatedAgent ? [{ token: tokens.delegate, principal_id: options.delegatedAgent.principal, role: 'agent',
        agent_id: options.delegatedAgent.agent, allowed_contexts: [{ ...context, session_id: options.delegatedAgent.sessionId }] }] : []),
      ...(options.reviewer ? [{ token: tokens.reviewer, principal_id: 'harness-reviewer', role: 'reviewer', allowed_contexts: [context] }] : []),
    ] });
    const python = process.env.CDE_PYTHON ?? (existsSync(join(rc2Root, '.venv-task/bin/python')) ? join(rc2Root, '.venv-task/bin/python') : 'python3');
    // startCde spawns synchronously before awaiting readiness; prevent source-tree pycache writes.
    const previous = process.env.PYTHONDONTWRITEBYTECODE;
    let starting;
    try { process.env.PYTHONDONTWRITEBYTECODE = '1'; starting = cdeModule.startCde(python); }
    finally { if (previous === undefined) delete process.env.PYTHONDONTWRITEBYTECODE; else process.env.PYTHONDONTWRITEBYTECODE = previous; }
    cde = await starting;
    const logs: RecordData[] = [];
    const app = gateway.createGatewayApp({ mode: 'evaluation', authority, authentication, adapter, execution,
      build: config.buildIdentity(kingpin.loadPolicy()), evaluateTurn: (packet: unknown) => cde!.evaluate(packet),
      logDecision: (record: RecordData) => logs.push(structuredClone(record)) });
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve) as Server;
      server.once('error', reject);
    });
    const address = server!.address();
    if (!address || typeof address === 'string') throw new Error('Gateway listener unavailable');
    const url = `http://127.0.0.1:${address.port}`;
    async function http(path: string, body?: RecordData, role: 'agent' | 'admin' | 'reviewer' | 'delegate' = 'agent') {
      const response = await fetch(url + path, { method: body ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
      return { status: response.status, body: await response.json() as RecordData,
        requestId: response.headers.get('x-request-id')!, reviewId: response.headers.get('x-review-id') };
    }
    async function readExecutionReceipt(executionId: string): Promise<RecordData> {
      const response = await http(`/executions/${encodeURIComponent(executionId)}`, undefined, 'admin');
      if (response.status !== 200 || response.body.execution_id !== executionId) {
        throw new Error('Execution receipt unavailable or identity mismatch');
      }
      return response.body;
    }
    const input = (request: GovernanceRequest) => {
      if (request.proposedAction !== 'action-x' || request.target !== 'target-x'
        || request.principal !== original.principal || request.agent !== original.agent
        || request.provenance.scenarioId !== original.provenance.scenarioId) throw new Error('Unbound Gateway request');
      return { ...context, speaker_id: request.agent, tool: 'fs.write',
        args: { path: 'effect.txt', content: 'deterministic governance fixture\n' },
        plan_id: request.requestId, user_request: 'Please write this test file.', dry_run: true, diff: 'create effect.txt' };
    };
    const inspect = (): RecordData => {
      if (!existsSync(target)) return { source: 'harness', exists: false };
      const stat = statSync(target, { bigint: true });
      return { source: 'harness', exists: true, content: readFileSync(target, 'utf8'),
        inode: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
    };
    const ledger = () => store!.transaction(tx => tx.executions.list());
    const audit = async (id: string) => {
      const response = await http(`/audit/${encodeURIComponent(id)}`, undefined, 'admin');
      if (response.status !== 200 || !Array.isArray(response.body.events)) throw new Error('Native audit unavailable');
      return response.body.events as RecordData[];
    };
    let lease: RecordData | undefined;
    const controls: RecordData[] = [];
    const seen = new Set<string>();
    const runtime: RuntimeAdapter = {
      async inject(control) {
        if (control.authorityRef !== original.authorityRef) throw new Error('Unknown authority reference');
        if (control.type === 'GRANT') {
          if (lease) throw new Error('Authority already initialized');
          const setup = await http('/tool/observed', { ...input(original), tool: 'fs.read', args: { path: 'seed.txt' } });
          if (setup.status !== 200) throw new Error(`Gateway setup failed: ${setup.status}`);
          const issued = await http('/lease', { ...input(original), seconds: 60 }, 'admin');
          if (issued.status !== 200 || !issued.body.lease_token || !issued.body.lease_id) throw new Error('Gateway lease issuance failed');
          lease = issued.body;
          const validation = authority.validateLease({ ...input(original), lease_token: lease.lease_token });
          if (!validation.valid) throw new Error('Issued authority not valid');
          const { lease_token: secret, ...publicLease } = lease;
          controls.push({ source: 'rc2:kingpin', type: 'GRANT', authorityRef: control.authorityRef,
            lease: publicLease, validation, audit: await audit(issued.requestId) });
        } else {
          if (!lease) throw new Error('No issued authority');
          // Default fs.write policy needs evidence, not a lease. Revoke the actual write capability.
          const revoked = await http('/revoke', input(original), 'admin');
          const validation = authority.validateLease({ ...input(original), lease_token: lease.lease_token });
          const events = await audit(revoked.requestId);
          if (revoked.status !== 200 || revoked.body.revoked !== true || revoked.body.target?.tool !== 'fs.write'
            || validation.valid || validation.reason !== 'capability_revoked'
            || !events.some(e => e.event_type === 'capability.revoked')) throw new Error('Capability revocation not acknowledged');
          controls.push({ source: 'rc2:kingpin', type: 'REVOKE', authorityRef: control.authorityRef,
            acknowledgement: revoked.body, nativeRequestId: revoked.requestId, validation, audit: events });
        }
      },
      async submit(request) {
        if (seen.has(request.requestId)) throw new Error('Fresh request ID required');
        if (!lease || request.authorityRef !== original.authorityRef
          || (request.leaseRef !== undefined && request.leaseRef !== lease.lease_id)) throw new Error('Unknown authority reference');
        seen.add(request.requestId);
        const ledgerBefore = ledger(), fileBefore = inspect(), logStart = logs.length;
        const response = await http('/tool/observed', { ...input(request), lease_token: lease.lease_token });
        const nativeAudit = await audit(response.requestId);
        const decisionEvent = nativeAudit.find(e => e.event_type === 'authority.decision');
        const log = logs.slice(logStart).find(r => r.endpoint === '/tool' && r.authority_decision?.evaluation_id === decisionEvent?.evaluation_id);
        if (!decisionEvent || !log) throw new Error('No correlated native decision observed');
        let receipt: RecordData | null = null, reconciled: RecordData | null = null;
        if (response.body.execution_id) {
          receipt = await readExecutionReceipt(response.body.execution_id);
          if (receipt.status === 'unknown') {
            const resolved = await http(`/executions/${receipt.execution_id}/reconcile`, {}, 'admin');
            if (resolved.status !== 200) throw new Error('Native reconciliation failed');
            reconciled = resolved.body;
          }
        }
        const evidence: GatewayEvidence = {
          sources: { scenario: 'harness', cde: 'rc2:cde', governance: 'rc2:kingpin', enforcement: 'rc2:gateway', execution: 'rc2:execution', fault: 'harness' },
          native: log.authority_decision, nativeRequestId: response.requestId, harnessRequest: structuredClone(request),
          gateway: { status: response.status, body: response.body }, audit: await audit(response.requestId),
          cde: { governance_signal: log.governance_signal, top_event: log.top_event, events: log.events },
          controls: structuredClone(controls), receipt, reconciled, ledgerBefore, ledgerAfter: ledger(),
          fileBefore, fileAfter: inspect(), sandbox,
          fault: { source: 'harness', type: 'terminal-receipt-transaction-failure', injected: faultInjected },
        };
        return { requestId: request.requestId, decisionId: decisionEvent.decision_id,
          result: normalizeDecision(evidence.native), rationale: evidence.native.reason,
          evidence: { kingpin_rc2_gateway: evidence } };
      },
    };
    const observe: ObserveEffects = async (request, decision) => translateEffects(request.requestId,
      decision.evidence.kingpin_rc2_gateway as GatewayEvidence);
    return { runtime, observe, close, root, http, audit, ledger, inspect, input, readExecutionReceipt };
  } catch (error) { await close(); throw error; }
}
