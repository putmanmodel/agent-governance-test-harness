import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { GovernanceRequest, RuntimeAdapter, RuntimeDecision } from '../../core/runtime-adapter.ts';

export const STDERR_DIAGNOSTIC_LIMIT = 2048;

type ObjectData = Record<string, unknown>;
function object(value: unknown): value is ObjectData {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

// Transport and translation only. Authority state belongs to the external process.
export class SubprocessAdapter implements RuntimeAdapter {
  #child;
  #lines;
  #counter = 0;
  #failure?: Error;
  #closing = false;
  #stderr = '';
  #closed: Promise<void>;
  #pending = new Map<string, { resolve: (value: ObjectData) => void; reject: (error: Error) => void }>();
  #decisions = new Set<string>();
  #evaluations = new Set<string>();
  #controls: ObjectData[] = [];
  #timeoutMs: number;

  constructor(command: string, args: string[], timeoutMs = 5000) {
    this.#timeoutMs = timeoutMs;
    this.#child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#closed = new Promise(resolve => this.#child.once('close', () => resolve()));
    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', chunk => { this.#stderr = (this.#stderr + chunk).slice(-8192); });
    this.#child.on('error', error => this.#fail(error));
    this.#child.stdin.on('error', error => this.#fail(error));
    this.#child.on('exit', (code, signal) => {
      if (!this.#closing || this.#pending.size || code !== 0) {
        this.#fail(new Error(`Subprocess exited prematurely (${code ?? signal}).`));
      }
    });
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on('line', line => {
      try {
        const value: unknown = JSON.parse(line);
        if (!object(value) || value.protocol_version !== '1' || !text(value.id)
            || !['ack', 'decision'].includes(String(value.kind))) throw new Error('Malformed or unknown protocol response');
        const pending = this.#pending.get(value.id);
        if (!pending) throw new Error(`Mismatched correlation ID: ${value.id}`);
        this.#pending.delete(value.id);
        pending.resolve(value);
      } catch (error) { this.#fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  get stderr(): string { return this.#stderr; }

  #diagnostic(error: Error): Error {
    const excerpt = this.#stderr.slice(-STDERR_DIAGNOSTIC_LIMIT);
    return excerpt ? new Error(`${error.message}\nSubprocess stderr (last ${STDERR_DIAGNOSTIC_LIMIT} characters):\n${excerpt}`) : error;
  }

  #fail(error: Error) {
    this.#failure ??= error;
    for (const p of this.#pending.values()) p.reject(this.#diagnostic(this.#failure));
    this.#pending.clear();
    this.#child.kill('SIGKILL');
  }

  async #exchange(body: ObjectData): Promise<ObjectData> {
    if (this.#failure) throw this.#diagnostic(this.#failure);
    if (this.#closing) throw new Error('Subprocess adapter is closed');
    const id = `message-${++this.#counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(new Error(`Protocol response timeout: ${id}`)), this.#timeoutMs);
      this.#pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.#child.stdin.write(JSON.stringify({ protocol_version: '1', id, ...body }) + '\n', error => {
        if (error) this.#fail(error);
      });
    });
  }

  async inject(control: { type: 'GRANT' | 'REVOKE'; authorityRef: string }): Promise<void> {
    const response = await this.#exchange({ op: 'inject', type: control.type, authority_ref: control.authorityRef });
    if (response.kind !== 'ack' || response.applied !== true || response.type !== control.type
        || response.authority_ref !== control.authorityRef) {
      const error = new Error('Invalid control acknowledgement'); this.#fail(error); throw this.#diagnostic(error);
    }
    this.#controls.push(structuredClone(response));
  }

  async submit(request: GovernanceRequest): Promise<RuntimeDecision> {
    const response = await this.#exchange({ op: 'submit', request: {
      request_id: request.requestId, principal_id: request.principal, agent_id: request.agent,
      action: request.proposedAction, target: request.target, authority_ref: request.authorityRef,
      lease_ref: request.leaseRef, provenance: { scenario_id: request.provenance.scenarioId, retry_of: request.provenance.retryOf },
      context: request.context,
    } });
    if (response.kind !== 'decision' || response.request_id !== request.requestId
        || !text(response.decision_id) || !text(response.evaluation_id)
        || this.#decisions.has(response.decision_id) || this.#evaluations.has(response.evaluation_id)
        || !['allow', 'deny'].includes(String(response.outcome)) || !text(response.reason)
        || !object(response.evidence) || (response.authority_ref !== undefined && response.authority_ref !== request.authorityRef)) {
      const error = new Error('Invalid, unsupported, stale or miscorrelated decision'); this.#fail(error); throw this.#diagnostic(error);
    }
    this.#decisions.add(response.decision_id); this.#evaluations.add(response.evaluation_id);
    return { requestId: request.requestId, decisionId: response.decision_id,
      result: response.outcome === 'allow' ? 'ALLOW' : 'DENY', rationale: response.reason,
      evidence: { subprocess: { native: structuredClone(response), controls: structuredClone(this.#controls),
        governance: 'external-process', enforcement: 'harness-simulation', execution: 'harness-simulation' } } };
  }

  async close(): Promise<void> {
    if (!this.#closing) { this.#closing = true; this.#child.stdin.end(); }
    const timer = setTimeout(() => this.#fail(new Error('Subprocess close timeout')), this.#timeoutMs);
    try { await this.#closed; } finally { clearTimeout(timer); this.#lines.close(); }
    if (this.#failure) throw this.#diagnostic(this.#failure);
  }
}
