import { createHmac, randomBytes } from 'node:crypto';
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
  contexts: { get(key: string): RecordData };
  revocations: { list(key: string): Set<string> };
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

export async function createGatewayAdapter(original: GovernanceRequest, options: { persistent?: { root: string; create: boolean }; receiptFailure?: boolean;
  memoryRotation?: boolean;
  agentChannels?: string[];
  detectorInput?: () => RecordData | undefined;
  restartRotation?: { phase: 'A' | 'B'; agent: string; retired: string; reviewer: string; tagKey: string;
    record(entry: RecordData): void };
  decorateExecutionAdapter?: (adapter: { execute(request: RecordData): unknown }) => { execute(request: RecordData): unknown };
  terminalSuccess?: (event: RecordData) => void;
  reconciled?: (evidence: unknown, outcome: string) => void;
  recovery?: { lockFile: string; before(): void; after(count: number): void };
  ownershipLock?: string;
  observeExecute?: boolean; reviewer?: boolean; beforeEffect?: (request: RecordData) => void; delegatedAgent?: { principal: string; agent: string; sessionId: string } } = {}) {
  const load = (file: string) => import(pathToFileURL(join(rc2Root, file)).href);
  const [kingpin, sqlite, gateway, sandboxModule, executionModule, authModule, cdeModule, config] = await Promise.all([
    load('kingpin/index.js'), load('kingpin/state/sqlite.js'), load('gateway_node/server.js'),
    load('evaluation/sandbox.js'), load('execution/runtime.js'), load('kingpin/auth/access.js'),
    load('evaluation/cde.js'), load('evaluation/config.js'),
  ]);
  const root = options.persistent?.root ?? mkdtempSync(join(tmpdir(), 'governance-gateway-'));
  const sandbox = join(root, 'sandbox');
  if (!options.persistent || options.persistent.create) {
    mkdirSync(sandbox, { mode: 0o700 });
    writeFileSync(join(sandbox, 'seed.txt'), 'read-only setup fixture\n', { mode: 0o600 });
  }
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
      try { await cde?.close(); } finally { try { store?.close(); } finally { if (!options.persistent) rmSync(root, { recursive: true, force: true }); } }
    }
  };
  try {
    store = options.memoryRotation ? new kingpin.MemoryStateStore() : new sqlite.SQLiteStateStore({ filename: join(root, 'state.sqlite'), create: options.persistent?.create ?? true }) as Store;
    const authority = new kingpin.KingpinAuthority({ store });
    const sandboxAdapter = sandboxModule.createSandboxAdapter(sandbox);
    const executeCalls: RecordData[] | undefined = options.observeExecute ? [] : undefined;
    let dispatch: RecordData | undefined;
    const rotation = options.memoryRotation || options.restartRotation;
    const entries: RecordData[] = [];
    const adapter = { ...sandboxAdapter, execute(request: RecordData) {
      if (rotation) {
        const entry = { ...dispatch, sequence: entries.length + 1, timestamp: new Date().toISOString(), operation: structuredClone(request) };
        entries.push(entry);
        options.restartRotation?.record(entry);
      }
      executeCalls?.push(structuredClone(request));
      options.beforeEffect?.(request);
      return sandboxAdapter.execute(request);
    }, reconcile(evidence: unknown) {
      const outcome = sandboxAdapter.reconcile(evidence);
      options.reconciled?.(evidence, outcome);
      return outcome;
    } };
    // The same transaction-failure injection used by RC2's execution.test.js.
    // The real adapter writes; SQLite rolls back only the terminal receipt, not the file.
    let faultInjected = false;
    const executionStore = { transaction<T>(work: (tx: Transaction) => T): T {
      return store!.transaction(tx => {
        const append = tx.audit.append;
        tx.audit.append = event => {
          const result = append(event);
          if (event.event_type === 'tool.execution.succeeded') options.terminalSuccess?.(event);
          if (options.receiptFailure !== false && !faultInjected && event.event_type === 'tool.execution.succeeded') {
            faultInjected = true;
            throw new Error('Harness-injected terminal receipt transaction failure');
          }
          return result;
        };
        return work(tx);
      });
    } };
    const execution = new executionModule.ExecutionRuntime({ store: executionStore, adapter: options.decorateExecutionAdapter?.(adapter) ?? adapter });
    const tokens = { agent: randomBytes(32).toString('base64url'), admin: randomBytes(32).toString('base64url'), reviewer: randomBytes(32).toString('base64url'), delegate: randomBytes(32).toString('base64url') };
    if (options.restartRotation) {
      tokens.agent = options.restartRotation.agent;
      tokens.reviewer = options.restartRotation.reviewer;
    }
    const context = { session_id: original.provenance.scenarioId, channel_id: 'channel', scene_id: 'scene', task_id: null };
    const makeAuthentication = () => authModule.createAuthentication({ schema_version: '1.0', principals: [
      { token: tokens.agent, principal_id: original.principal, role: 'agent', agent_id: original.agent, allowed_contexts: options.agentChannels?.map(channel_id => ({ ...context, channel_id })) ?? [context] },
      { token: tokens.admin, principal_id: 'harness-admin', role: 'authority_admin' },
      ...(options.delegatedAgent ? [{ token: tokens.delegate, principal_id: options.delegatedAgent.principal, role: 'agent',
        agent_id: options.delegatedAgent.agent, allowed_contexts: [{ ...context, session_id: options.delegatedAgent.sessionId }] }] : []),
      ...(options.reviewer ? [{ token: tokens.reviewer, principal_id: 'harness-reviewer', role: 'reviewer', allowed_contexts: [context] }] : []),
    ] });
    let authentication = makeAuthentication();
    const python = process.env.CDE_PYTHON ?? (existsSync(join(rc2Root, '.venv-task/bin/python')) ? join(rc2Root, '.venv-task/bin/python') : 'python3');
    // startCde spawns synchronously before awaiting readiness; prevent source-tree pycache writes.
    const previous = process.env.PYTHONDONTWRITEBYTECODE;
    let starting;
    try { process.env.PYTHONDONTWRITEBYTECODE = '1'; starting = cdeModule.startCde(python, options.recovery?.lockFile ?? options.ownershipLock); }
    finally { if (previous === undefined) delete process.env.PYTHONDONTWRITEBYTECODE; else process.env.PYTHONDONTWRITEBYTECODE = previous; }
    cde = await starting;
    // Match native startEvaluation: exclusive evaluator ownership precedes recover(), then serving.
    if (options.recovery) { options.recovery.before(); options.recovery.after(execution.recover()); }
    const logs: RecordData[] = [];
    async function listen() {
      const app = gateway.createGatewayApp({ mode: 'evaluation', authority, authentication, adapter, execution,
        build: config.buildIdentity(kingpin.loadPolicy()), evaluateTurn: (packet: unknown) => options.detectorInput?.() ?? cde!.evaluate(packet),
        logDecision: (record: RecordData) => logs.push(structuredClone(record)) });
      await new Promise<void>((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve) as Server;
        server.once('error', reject);
      });
      const address = server!.address();
      if (!address || typeof address === 'string') throw new Error('Gateway listener unavailable');
      return `http://127.0.0.1:${address.port}`;
    }
    let url = await listen();
    let phase = options.restartRotation?.phase ?? 'A';
    const tagKey = options.restartRotation?.tagKey ?? randomBytes(32);
    const tag = (header: string) => createHmac('sha256', tagKey).update(header).digest('hex');
    const firstToken = options.restartRotation?.retired ?? tokens.agent;
    const consumption: RecordData[] = [];
    if (rotation) {
      const consume = authority.consumeReview.bind(authority);
      authority.consumeReview = (id: string, operation: RecordData, principal: RecordData) => {
        const entry: RecordData = { id, operation: structuredClone(operation), principal, phase };
        consumption.push(entry);
        try {
          const result = consume(id, operation, principal);
          entry.authorized = result.execution_authorized;
          if (result.reason !== undefined) entry.reason = result.reason;
          return result;
        } catch (error) {
          entry.error = (error as Error).message;
          throw error;
        }
      };
    }
    async function rotate() {
      if (!options.memoryRotation || phase !== 'A' || !server?.listening) throw new Error('Invalid ingress rotation');
      const old = server;
      old.closeAllConnections();
      await new Promise<void>((ok, fail) => old.close(error => error ? fail(error) : ok()));
      tokens.agent = randomBytes(32).toString('base64url');
      authentication = makeAuthentication();
      phase = 'B';
      url = await listen();
      return { retiredListening: old.listening, pid: process.pid, store: store!.constructor.name };
    }
    type Role = keyof typeof tokens;
    async function exchange(path: string, serialized: string | undefined, role: Role | 'retired') {
      const authorization = `Bearer ${role === 'retired' ? firstToken : tokens[role]}`;
      const method = serialized === undefined ? 'GET' : 'POST';
      if (rotation) dispatch = { phase, tag: tag(authorization), reviewId: path.split('/')[2] };
      const response = await fetch(url + path, { method,
        headers: { authorization, 'content-type': 'application/json' },
        body: serialized, signal: AbortSignal.timeout(20_000) });
      let principal = null;
      try { principal = authentication.authenticate(authorization); }
      catch (error) { if (role !== 'retired' || (error as {status?: number}).status !== 401) throw error; }
      return { transport: { path, method, serialized, principal, ...(rotation ? { tag: tag(authorization), phase, pid: process.pid, url } : {}) }, response: { status: response.status, body: await response.json() as RecordData,
        requestId: response.headers.get('x-request-id')!, reviewId: response.headers.get('x-review-id') } };
    }
    async function http(path: string, body?: RecordData, role: Role = 'agent') {
      return (await exchange(path, JSON.stringify(body), role)).response;
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
    return { build: config.buildIdentity(kingpin.loadPolicy()), runtime, observe, close, root, http, exchange, rotate, consumption, entries,
      authorityState: (key: string) => store!.transaction(tx => ({ context: tx.contexts.get(key), revoked: [...tx.revocations.list(key)] })),
      executeObservation: () => ({ ready: executeCalls !== undefined, calls: structuredClone(executeCalls) }), audit, ledger, inspect, input, readExecutionReceipt,
      // Trusted test-host transport only; credentials must never enter artifacts.
      adminConnection: { url, authorization: `Bearer ${tokens.admin}` } };
  } catch (error) { await close(); throw error; }
}
