import { createServer } from 'node:http';

/** Only the inference transport is scripted; OpenCode owns dispatch and permissions. */
export async function startModel(record: (type: string, data: Record<string, unknown>) => void) {
  let command: string | undefined, callId = '', issued = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') throw Error('Unexpected model endpoint');
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      record('model-request', input);
      const tools = input.tools?.some((t: any) => t.function?.name === 'bash');
      const result = input.messages?.some((m: any) => m.role === 'tool');
      const invoke = tools && !result;
      if (invoke && (!command || issued)) throw Error('Unconfigured or repeated model tool request');
      if (invoke) issued = true;
      const message = invoke ? { role: 'assistant', content: null, tool_calls: [{ id: callId, type: 'function',
        function: { name: 'bash', arguments: JSON.stringify({ command, description: 'Bounded local receiver operation', timeout: 2000 }) } }] }
        : { role: 'assistant', content: 'local-script-complete' };
      record('model-response', { message, auxiliary: !tools });
      const common = { id: 'local-script', created: 1, model: 'test' };
      if (input.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const delta = invoke ? { role: 'assistant', tool_calls: message.tool_calls!.map(t => ({ ...t, index: 0 })) } : message;
        for (const choice of [{ index: 0, delta, finish_reason: null },
          { index: 0, delta: {}, finish_reason: invoke ? 'tool_calls' : 'stop' }]) {
          res.write(`data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [choice] })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...common, object: 'chat.completion', choices: [{ index: 0, message,
          finish_reason: invoke ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }
    } catch (error) { record('model-error', { error: String(error) }); res.writeHead(500); res.end('Script error'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Model address missing');
  return { port: address.port, configure(value: string, id: string) { command = value; callId = id; },
    close() { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); } };
}
