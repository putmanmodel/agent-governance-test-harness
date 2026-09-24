import { parentPort, workerData } from 'node:worker_threads';
import { createGatewayAdapter } from './gateway.ts';
import { inFlightRequest } from '../../../scenarios/in-flight-revocation.ts';

const port = parentPort!;
const gate = new Int32Array(workerData.gate as SharedArrayBuffer);
let entered = false;
const f = await createGatewayAdapter(inFlightRequest, { receiptFailure: false, beforeEffect(request) {
  if (request.tool !== 'fs.write' || entered) return;
  entered = true;
  port.postMessage({ type: 'barrier' });
  // Runs inside RC2's synchronous execution transaction, after its start commit.
  if (Atomics.wait(gate, 0, 0, 15_000) === 'timed-out') throw new Error('Harness barrier release timed out');
} });
const input = f.input(inFlightRequest);
port.postMessage({ type: 'ready', root: f.root, input, connection: f.adminConnection });
port.on('message', async ({ type, firstId, executionId }: { type: string; firstId?: string; executionId?: string }) => {
  try {
    if (type === 'first') {
      port.postMessage({ type, response: await f.http('/tool/observed', input) });
    } else if (type === 'collect') {
      port.postMessage({ type, audit: await f.audit(firstId!), receipt: await f.readExecutionReceipt(executionId!),
        ledger: f.ledger(), file: f.inspect() });
    } else if (type === 'later') {
      const before = { ledger: f.ledger(), file: f.inspect() };
      const response = await f.http('/tool/observed', { ...input, plan_id: 'in-flight-later' });
      const receipt = response.body.execution_id ? await f.readExecutionReceipt(response.body.execution_id) : null;
      port.postMessage({ type, response, audit: await f.audit(response.requestId), receipt,
        before, after: { ledger: f.ledger(), file: f.inspect() } });
    } else if (type === 'close') {
      await f.close(); port.postMessage({ type }); port.close();
    }
  } catch (error) { port.postMessage({ type, error: String(error) }); }
});
