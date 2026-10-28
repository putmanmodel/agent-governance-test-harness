import assert from 'node:assert/strict';
import { createHash, timingSafeEqual } from 'node:crypto';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';

export const BODY = 'harness-sdk-effect-v1\n';
export const REPRESENTATION = 'fixture-http-operation.v1: [method,path,query,content-type,body-sha256]';
export const operationBinding = JSON.stringify(['POST', '/effect', '', 'application/octet-stream',
  createHash('sha256').update(BODY).digest('hex')]);
export interface WorkerConfig {
  port: number; requestId: string; credential: string;
  identities: { digest: string; principal: 'writer' | 'reader' }[];
  duplicate: boolean; journal: string;
}
export interface WorkerRecord { sequence: number; type: string; data: Record<string, unknown> }

export function authenticate(credential: string, identities: WorkerConfig['identities']): 'writer' | 'reader' {
  const digest = createHash('sha256').update(credential).digest();
  const matches = identities.filter(i => /^[a-f0-9]{64}$/.test(i.digest)
    && timingSafeEqual(digest, Buffer.from(i.digest, 'hex')));
  assert.equal(matches.length, 1, 'Invalid or ambiguous local fixture credential');
  return matches[0].principal;
}

async function main(config: WorkerConfig) {
  assert.ok(Number.isInteger(config.port) && config.port > 0 && config.port <= 65535);
  const fd = openSync(config.journal, 'ax', 0o600);
  let sequence = 0;
  const record = (type: string, data: Record<string, unknown> = {}) => {
    writeSync(fd, JSON.stringify({ sequence: ++sequence, type, data }) + '\n'); fsyncSync(fd);
  };
  try {
    record('worker-start', { pid: process.pid });
    // No hosted inference or exporter is needed. Fail loudly on unexpected fetch.
    globalThis.fetch = async () => { record('unexpected-network'); throw new Error('Network fetch disabled in local SDK fixture'); };
    const { Agent, Runner, tool, setTracingDisabled } = await import('@openai/agents');
    const { ScriptedModel, functionCall, assistantMessage, modelResponder } = await import('@openai/agents/testing');
    setTracingDisabled(true);
    let invocations = 0, authorizations = 0;
    const callId = `call-${config.requestId}`;
    const expectedResult = authenticate(config.credential, config.identities) === 'writer' ? 'effect-recorded' : 'denied';
    const model = new ScriptedModel([
      [functionCall('bounded_effect', {}, { callId })],
      modelResponder(call => {
        assert.ok(Array.isArray(call.request.input));
        const results = call.request.input.filter(i => i.type === 'function_call_result');
        assert.equal(results.length, 1);
        assert.equal(results[0].callId, callId);
        const output = results[0].output;
        assert.equal(typeof output === 'string' ? output : !Array.isArray(output) && output.type === 'text' ? output.text : undefined, expectedResult);
        record('model-observed-tool-result', { callId, result: expectedResult });
        return [assistantMessage('fixture-complete')];
      }),
    ]);
    const effectTool = tool({
      name: 'bounded_effect', description: 'Perform the bounded application fixture operation.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } as const,
      errorFunction: null,
      async execute(_args, context) {
        invocations++;
        record('tool-entry', { callId });
        const principal = authenticate((context?.context as { credential: string }).credential, config.identities);
        record('identity', { principal, requestId: config.requestId, validation: 'local-credential-sha256-match' });
        // Constructed application policy, not SDK governance or Harness authority.
        const allowed = principal === 'writer';
        authorizations++;
        record('authorization', { requestId: config.requestId, decisionId: `decision-${config.requestId}`,
          principal, outcome: allowed ? 'ALLOW' : 'DENY', effectAuthorized: allowed, binding: operationBinding });
        record('enforcement', { disposition: allowed ? 'allow' : 'block', reason: allowed ? 'fixture-writer' : 'fixture-reader' });
        if (!allowed) return 'denied';
        for (let i = 0; i < (config.duplicate ? 2 : 1); i++) {
          record('dispatch', { ordinal: i + 1 });
          await new Promise<void>((resolve, reject) => {
            const req = request({ hostname: '127.0.0.1', port: config.port, path: '/effect', method: 'POST',
              agent: false, headers: { 'content-type': 'application/octet-stream', 'content-length': Buffer.byteLength(BODY) } }, res => {
              res.resume(); res.on('error', reject);
              res.on('end', () => res.statusCode === 201 ? resolve() : reject(new Error(`Receiver status ${res.statusCode}`)));
            });
            req.on('error', reject);
            req.setTimeout(1000, () => req.destroy(new Error('Receiver request timed out')));
            req.end(BODY);
          });
        }
        return 'effect-recorded';
      },
    });
    const agent = new Agent({ name: 'Local application fixture', model, tools: [effectTool] });
    const runner = new Runner({ model, tracingDisabled: true, traceIncludeSensitiveData: false });
    runner.on('agent_tool_start', (_context, _agent, tool, details) => {
      record('sdk-tool-start', { name: tool.name, callId: 'callId' in details.toolCall ? details.toolCall.callId : null });
    });
    runner.on('agent_tool_end', (_context, _agent, tool, result, details) => {
      record('sdk-tool-end', { name: tool.name, result, callId: 'callId' in details.toolCall ? details.toolCall.callId : null });
    });
    const result = await runner.run(agent, 'Perform the fixed fixture operation.', {
      context: { credential: config.credential }, maxTurns: 2,
    });
    model.assertComplete();
    assert.equal(model.calls.length, 2);
    assert.equal(invocations, 1); assert.equal(authorizations, 1);
    assert.equal(result.finalOutput, 'fixture-complete');
    record('complete', { modelCalls: model.calls.length, invocations, authorizations, scriptComplete: true,
      tracingDisabled: true, finalOutput: result.finalOutput });
  } catch (error) {
    record('error', { message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  } finally { closeSync(fd); process.disconnect?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.once('message', config => { void main(config as WorkerConfig).catch(() => { process.exitCode = 1; process.disconnect?.(); }); });
}
