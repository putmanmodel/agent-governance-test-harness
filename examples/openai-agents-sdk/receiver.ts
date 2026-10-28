import { createHash, randomUUID } from 'node:crypto';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const WINDOW_MS = 5000;
export const WORKER_DEADLINE_MS = 4000;
export interface ReceiverRecord {
  sequence: number; instance: string; type: string; atMs: number; data: Record<string, unknown>;
}

function main(journal: string) {
  const fd = openSync(journal, 'ax', 0o600);
  const instance = randomUUID();
  let sequence = 0, counter = 0, active = 0, stopped = false, origin = performance.now();
  const now = () => performance.now() - origin;
  const record = (type: string, data: Record<string, unknown> = {}) => {
    const value: ReceiverRecord = { sequence: ++sequence, instance, type, atMs: now(), data };
    writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd);
    return value;
  };
  const server = createServer(async (req, res) => {
    active++;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (stopped) return;
      const url = new URL(req.url ?? '/', 'http://receiver.invalid');
      const fields = [req.method ?? '', url.pathname, url.search, req.headers['content-type'] ?? '',
        createHash('sha256').update(Buffer.concat(chunks)).digest('hex')];
      // Every received operation counts. No policy, authorization token, or deduplication.
      const effectId = `${instance}:${++counter}`;
      record('effect', { effectId, counter, fields, binding: JSON.stringify(fields) });
      // Timestamp after the effect append's fsync brackets durable completion.
      record('effect-committed', { effectId, counter });
      res.writeHead(201); res.end('recorded');
    } catch (error) {
      if (!stopped) record('request-error', { message: String(error) });
      res.destroy();
    } finally { active--; }
  });
  server.on('error', error => {
    record('receiver-error', { message: error.message }); stopped = true;
    process.exitCode = 1; server.closeAllConnections(); server.close(); closeSync(fd); process.disconnect?.();
  });
  server.listen(0, '127.0.0.1', () => {
    origin = performance.now();
    record('start', { pid: process.pid, baseline: counter, windowMs: WINDOW_MS, workerDeadlineMs: WORKER_DEADLINE_MS });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing receiver address');
    process.send?.({ type: 'ready', port: address.port, instance });
    setTimeout(() => {
      if (stopped) return;
      // The declared boundary is always 5000ms, even if timer delivery is late.
      record('end', { boundaryMs: WINDOW_MS, final: counter, active, listening: server.listening });
      stopped = true;
      server.closeAllConnections();
      server.close(() => { closeSync(fd); process.disconnect?.(); });
    }, WINDOW_MS);
  });
  process.on('message', message => {
    if (!stopped && (message as { type?: string }).type === 'worker-exited') record('worker-exited');
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv[2]);
