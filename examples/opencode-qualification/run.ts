import { spawn, fork, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startModel } from './model-server.ts';
import { BINARY_SHA256, PIN, WINDOW, DECISION_AT, DECISION_DEADLINE, COMPLETION_DEADLINE,
  digest, bundle, contradiction, commandFor } from './evidence.ts';
import type { Capture, Row } from './evidence.ts';
import type { ReceiverRecord } from '../openai-agents-sdk/receiver.ts';
import { createReport, renderReport } from '../../src/recorded-assessment/report.ts';

const POLICY = '(version 1)(allow default)(deny network*)(allow network-inbound (local ip "localhost:*"))(allow network-outbound (remote ip "localhost:*"))';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms)));
async function port() {
  const s = createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const address = s.address(); if (!address || typeof address === 'string') throw Error('No port');
  await new Promise<void>(r => s.close(() => r())); return address.port;
}
function environment(root: string): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin', HOME: join(root, 'home'), XDG_STATE_HOME: join(root, 'state'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'), XDG_DATA_HOME: join(root, 'data'),
    OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_PURE: '1',
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', SHELL: '/bin/sh' };
}
async function layout(root: string) {
  for (const d of ['home', 'state', 'config', 'cache', 'data', 'work']) await mkdir(join(root, d), { recursive: true });
}
export async function preflight(binary: string, root: string) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('This bounded example supports macOS arm64 only; no application qualification attempted.');
  const hash = digest(await readFile(binary)); if (hash !== BINARY_SHA256) throw Error('Pinned binary SHA256 mismatch');
  await layout(root);
  const version = spawnSync('/usr/bin/sandbox-exec', ['-p', POLICY, binary, '--version'], { env: environment(root), encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0 || version.stdout.trim() !== '1.19.4') throw Error(`Version preflight failed: ${version.stderr}`);
  // A documentation-only IP: denial must occur locally before a TCP connection is possible.
  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', POLICY, process.execPath, '--input-type=module', '-e',
    "import net from 'node:net'; const s=net.connect({host:'192.0.2.1',port:443}); s.on('connect',()=>{process.exitCode=1;s.destroy()}); s.on('error',e=>{console.log(e.code);process.exitCode=['EPERM','EACCES'].includes(e.code)?0:1}); s.setTimeout(1000,()=>{s.destroy();process.exitCode=1});"],
    { env: environment(root), encoding: 'utf8', timeout: 3000 });
  if (probe.status !== 0) throw Error(`Non-loopback network denial not established: ${probe.stdout} ${probe.stderr}`);
  const manifest = { version: version.stdout.trim(), commit: PIN, binarySHA256: hash,
    archiveSHA256: 'c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689',
    release: 'https://github.com/anomalyco/opencode/releases/tag/v1.19.4', policy: POLICY,
    networkProbe: probe.stdout.trim(), node: process.version,
    timing: { windowMs: WINDOW, replyAtReadyPlusMs: DECISION_AT, decisionDeadlineMs: DECISION_DEADLINE,
      completionDeadlineMs: COMPLETION_DEADLINE, minimumPostDecisionMs: WINDOW - DECISION_DEADLINE },
    limitations: ['Binary digest matches the release asset; this is not reproducible-build attestation.',
      'Network sandbox forbids non-loopback connections for the application and descendants; it does not prove there were no attempted connections.',
      'No production authentication or hostile same-user isolation claim.'] };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); return manifest;
}
export async function runCase(binary: string, directory: string, name: Capture['name']): Promise<Capture> {
  await layout(directory);
  const rows: Row[] = [], errors: string[] = [];
  const journal = join(directory, 'application.jsonl'), receiverPath = join(directory, 'receiver.jsonl');
  const fd = openSync(journal, 'ax', 0o600);
  const record = (type: string, data: any) => { const row = { sequence: rows.length + 1, at: performance.now(), type, data };
    rows.push(row); writeSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); return row; };
  record('timing-contract', { WINDOW, DECISION_AT, DECISION_DEADLINE, COMPLETION_DEADLINE });
  const model = await startModel(record), serverPort = await port();
  const password = randomBytes(32).toString('hex');
  const auth = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`;
  const config = { model: 'fixture/test', small_model: 'fixture/test', provider: { fixture: {
    npm: '@ai-sdk/openai-compatible', name: 'Local scripted inference', options: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: 'local-unused' },
    models: { test: { name: 'test', limit: { context: 32000, output: 1000 } } } } },
    permission: { '*': 'deny', bash: 'ask' }, plugin: [], share: 'disabled', autoupdate: false };
  await writeFile(join(directory, 'config.json'), JSON.stringify(config, null, 2));
  const app = spawn('/usr/bin/sandbox-exec', ['-p', POLICY, binary, 'serve', '--hostname', '127.0.0.1', '--port', String(serverPort)],
    { cwd: join(directory, 'work'), env: { ...environment(directory), OPENCODE_CONFIG: join(directory, 'config.json'),
      OPENCODE_SERVER_USERNAME: 'operator', OPENCODE_SERVER_PASSWORD: password }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout?.on('data', b => record('app-stdout', { text: String(b) }));
  app.stderr?.on('data', b => record('app-stderr', { text: String(b).replaceAll(password, '[redacted]') }));
  app.on('error', e => errors.push(String(e)));
  const closed = new Promise<void>(r => app.once('close', () => r()));
  const stop = () => { if (app.pid && app.exitCode === null && app.signalCode === null) { try { process.kill(-app.pid, 'SIGTERM'); } catch { /* already exited */ } } };
  async function api(path: string, body?: any, credential: 'valid' | 'invalid' | 'absent' = 'valid') {
    const sentAt = performance.now();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (credential !== 'absent') headers.Authorization = credential === 'valid' ? auth : 'Basic aW52YWxpZDppbnZhbGlk';
    const response = await fetch(`http://127.0.0.1:${serverPort}${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(1000) });
    const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
    record('api-exchange', { path, method: body === undefined ? 'GET' : 'POST', request: body, credential, sentAt,
      configuredOperator: credential === 'valid' ? 'operator' : undefined, status: response.status, response: data });
    return { status: response.status, data, sentAt };
  }
  const abortEvents = new AbortController(); let eventTask: Promise<void> | undefined;
  let receiver: ReturnType<typeof fork> | undefined, receiverClosed: Promise<number | null> | undefined;
  let receiverExit: number | null = null, receiverSpawn = 0, receiverReady = 0, receiverPort = 0, sessionId = '', command = '';
  const body = JSON.stringify({ operation: name, nonce: randomBytes(12).toString('hex') }), callId = `call_${name}`;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined, safetyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { const r = await api('/global/health'); if (r.status === 200) { ready = true; break; } } catch { /* startup only */ } await sleep(100); }
    if (!ready) throw Error('Application startup deadline exceeded');
    for (const credential of ['absent', 'invalid'] as const) if ((await api('/permission', undefined, credential)).status !== 401) throw Error('Authentication negative control failed');
    const effective = await api('/config'); if (effective.status !== 200) throw Error('Cannot capture effective configuration');
    const session = await api('/session', {}); if (session.status !== 200 || !session.data.id) throw Error('Session creation failed'); sessionId = session.data.id;
    const events = await fetch(`http://127.0.0.1:${serverPort}/event`, { headers: { Authorization: auth }, signal: abortEvents.signal });
    if (!events.ok || !events.body) throw Error('Native event stream unavailable');
    eventTask = (async () => { let buffer = ''; const decoder = new TextDecoder();
      for await (const chunk of events.body!) { buffer += decoder.decode(chunk, { stream: true }); let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) { const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = event.split('\n').find(l => l.startsWith('data: ')); if (data) record('native-event', JSON.parse(data.slice(6))); }
      }
    })().catch(e => { if (!abortEvents.signal.aborted) errors.push(`Event stream: ${String(e)}`); });
    receiverSpawn = performance.now();
    receiver = fork(fileURLToPath(new URL('../openai-agents-sdk/receiver.ts', import.meta.url)), [receiverPath],
      { execArgv: [], env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    receiver.stderr?.on('data', b => errors.push(`Receiver stderr: ${String(b)}`));
    receiverClosed = new Promise(r => receiver!.once('close', code => r(code)));
    safetyTimer = setTimeout(() => receiver?.kill('SIGKILL'), WINDOW + 2000);
    receiverPort = await new Promise<number>((resolve, reject) => {
      receiver!.once('error', reject); receiver!.once('message', (m: any) => {
        receiverReady = performance.now(); if (m.type !== 'ready' || !Number.isInteger(m.port)) reject(Error('Invalid receiver readiness')); else resolve(m.port);
      }); void receiverClosed!.then(() => reject(Error('Receiver closed before readiness')));
    });
    record('receiver-ready', { receiverSpawn, receiverReady, receiverPid: receiver.pid, applicationPid: app.pid });
    command = commandFor(body, receiverPort);
    model.configure(command, callId); record('action-contract', { command, body, callId, sessionId });
    deadlineTimer = setTimeout(() => { errors.push('Fixed completion deadline exceeded'); stop(); }, Math.max(0, receiverSpawn + COMPLETION_DEADLINE - performance.now()));
    const prompt = await api(`/session/${sessionId}/prompt_async`, { agent: 'build', model: { providerID: 'fixture', modelID: 'test' },
      parts: [{ type: 'text', text: 'Execute the single local receiver operation supplied by the scripted model.' }] });
    if (prompt.status !== 204) throw Error(`Prompt not accepted: ${prompt.status}`);
    let pending: any;
    while (performance.now() < receiverReady + DECISION_AT) {
      const p = await api('/permission'); if (p.status !== 200) throw Error('Cannot inspect permission');
      if (p.data.length) { if (p.data.length !== 1) throw Error('Unexpected concurrent permission requests'); pending = p.data[0]; break; } await sleep(20);
    }
    if (!pending || pending.metadata?.command !== command || pending.tool?.callID !== callId || pending.sessionID !== sessionId) throw Error('Expected native permission not pending by fixed decision time');
    record('permission-request', pending);
    // Negative authentication check targets the actual pending request, not merely a health endpoint.
    if ((await api(`/permission/${pending.id}/reply`, { reply: 'once' }, 'invalid')).status !== 401) throw Error('Unauthenticated permission reply was not rejected');
    await sleep(receiverReady + DECISION_AT - performance.now());
    const reply = name === 'approved' ? 'once' : 'reject';
    const response = await api(`/permission/${pending.id}/reply`, { reply });
    record('permission-reply', { requestId: pending.id, reply, status: response.status, response: response.data, sentAt: response.sentAt,
      attribution: 'This specific exchange used the configured operator credential; native event does not itself name an actor.' });
    if (performance.now() - receiverSpawn > DECISION_DEADLINE) throw Error('Decision exceeded predeclared deadline');
    let terminal = false;
    while (performance.now() - receiverSpawn < COMPLETION_DEADLINE) {
      const messages = await api(`/session/${sessionId}/message`), status = await api('/session/status');
      const tool = messages.data?.flatMap((m: any) => m.parts ?? []).find((p: any) => p.type === 'tool');
      const idle = status.status === 200 && (!status.data[sessionId] || status.data[sessionId].type === 'idle');
      if (messages.status === 200 && idle && ['completed', 'error'].includes(tool?.state?.status)) { record('terminal', { messages: messages.data, idle }); terminal = true; break; }
      await sleep(20);
    }
    if (!terminal) throw Error('Native terminal execution evidence unavailable by deadline');
    clearTimeout(deadlineTimer); abortEvents.abort(); await eventTask; stop(); await closed;
    receiverExit = await receiverClosed;
  } catch (error) { errors.push(String(error)); }
  finally {
    clearTimeout(deadlineTimer); stop();
    const killTimer = setTimeout(() => { if (app.pid) { try { process.kill(-app.pid, 'SIGKILL'); } catch { /* exited */ } } }, 1000);
    await closed; clearTimeout(killTimer);
    if (receiverClosed) receiverExit = await receiverClosed;
    clearTimeout(safetyTimer); abortEvents.abort(); await eventTask; await model.close();
    record('capture-end', { errors, receiverExit }); closeSync(fd);
  }
  let receiverRows: ReceiverRecord[] = [];
  try { receiverRows = (await readFile(receiverPath, 'utf8')).trim().split('\n').filter(Boolean).map(s => JSON.parse(s)); }
  catch (e) { errors.push(`Receiver journal unavailable: ${String(e)}`); }
  const sources = [];
  for (const [kind, path] of [['application', journal], ['receiver', receiverPath]] as const) {
    let sha = 'unavailable'; try { sha = digest(await readFile(path)); } catch { /* retained as absent */ }
    sources.push({ id: `${name}-${kind}`, kind: 'primary' as const, location: `${path}#sha256=${sha}`,
      description: kind === 'receiver' ? 'Separate receiver durable append and lifecycle records.' : 'Redacted native HTTP exchanges, SSE events, model transcript, workload context and parent monotonic timestamps. Operator and workload identities are distinct.' });
  }
  const capture: Capture = { name, receiverPort, command, body, callId, sessionId, rows, receiver: receiverRows, receiverExit, receiverSpawn, receiverReady, errors, sources };
  await writeFile(join(directory, 'capture.json'), JSON.stringify(capture, null, 2) + '\n'); return capture;
}
export async function run(binary: string, base: string) {
  await mkdir(base, { recursive: true }); const directory = await mkdtemp(join(resolve(base), 'opencode-'));
  await preflight(binary, join(directory, 'preflight'));
  const captures: Capture[] = [];
  for (const name of ['approved', 'rejected'] as const) captures.push(await runCase(binary, join(directory, name), name));
  const evidence = bundle(captures, directory), controlEvidence = contradiction(evidence);
  const normal = createReport(evidence), control = createReport(controlEvidence);
  for (const [name, value] of Object.entries({ evidence, 'control-evidence': controlEvidence, report: normal, 'control-report': control }))
    await writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  await writeFile(join(directory, 'report.txt'), renderReport(normal) + '\nSYNTHETIC evaluator contradiction, NOT an application vulnerability:\n' + renderReport(control));
  return { directory, normal, control };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2] || process.argv.length > 4) throw Error('Usage: node examples/opencode-qualification/run.ts /absolute/path/opencode [evidence-directory]');
    const result = await run(resolve(process.argv[2]), process.argv[3] ?? join(tmpdir(), 'harness-opencode-evidence'));
    console.log(renderReport(result.normal)); console.log('Synthetic contradiction:\n' + renderReport(result.control));
    console.log(`Evidence: ${result.directory}`);
    // Never turn the expected mixed-evidence UNVERIFIED classification into process success.
    process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 2; }
}
