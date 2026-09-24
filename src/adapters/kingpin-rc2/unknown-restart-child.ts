import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createGatewayAdapter } from './gateway.ts';
import { crashSnapshot } from './unknown-restart-snapshot.ts';
import { unknownRestartRequest } from '../../../scenarios/unknown-execution-survives-restart.ts';
const [root, mode, crashCase = 'after-effect'] = process.argv.slice(2);
function observe(data: object) {
  const fd = openSync(join(root, 'calls.jsonl'), 'a', 0o600);
  try { writeSync(fd, JSON.stringify({ source: 'harness:sandbox-call-observation', pid: process.pid, ...data }) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
}
let before: ReturnType<typeof crashSnapshot> | undefined, count: number | undefined;
const f = await createGatewayAdapter(unknownRestartRequest, {
  persistent: { root, create: mode === 'create' }, receiptFailure: false,
  ownershipLock: join(root, 'state.sqlite.runtime.lock'),
  beforeEffect(request) {
    // 'execute' observes entry into the harness wrapper, not a completed physical effect.
    observe({ method: 'execute', request });
    if (crashCase === 'before-effect') {
      process.send!({ type: 'boundary', pid: process.pid, source: 'harness:before-native-execute', request });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
  },
  reconciled(evidence, outcome) { observe({ method: 'reconcile', evidence, outcome }); },
  ...(mode === 'reopen' ? { recovery: { lockFile: join(root, 'state.sqlite.runtime.lock'),
    before() { before = crashSnapshot(root); }, after(n: number) { count = n; } } } : {}),
  terminalSuccess(event) {
    // append is inside the uncommitted terminal transaction. Never return to commit it.
    // IPC delivers the signal while the main thread waits for the parent's real SIGKILL.
    process.send!({ type: 'boundary', pid: process.pid, source: 'harness:uncommitted-terminal-append', event });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  },
});
process.send!({ type: 'ready', pid: process.pid, mode, build: f.build, before, recovered: count,
  snapshot: crashSnapshot(root), ownership: 'native-cde-exclusive-lock-acquired' });
process.on('message', async (message: any) => {
  try {
    if (message.type === 'execute') {
      // A real observed write needs no lease or extra warmup execution in this fixture.
      const response = await f.http('/tool/observed', f.input(unknownRestartRequest));
      throw new Error(`Expected crash boundary, Gateway returned ${response.status}`);
    } else if (message.type === 'close') { await f.close(); process.disconnect(); }
  } catch (error) { process.send!({ type: 'boundary', error: String(error) }); await f.close(); process.exitCode = 1; process.disconnect(); }
});
