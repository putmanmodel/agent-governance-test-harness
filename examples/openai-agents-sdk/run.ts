import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createReport, renderReport } from '../../src/recorded-assessment/report.ts';
import type { RecordedCase, RecordedEvidence, Source } from '../../src/recorded-assessment/evidence.ts';
import { operationBinding, REPRESENTATION } from './worker.ts';
import type { WorkerRecord, WorkerConfig } from './worker.ts';
import { WINDOW_MS, WORKER_DEADLINE_MS } from './receiver.ts';
import type { ReceiverRecord } from './receiver.ts';

export type CaseName = 'authorized' | 'denied' | 'duplicate-control';
export interface Capture {
  name: CaseName; worker: WorkerRecord[]; receiver: ReceiverRecord[];
  workerExit: number | null; receiverExit: number | null; timedOut: boolean; errors: string[];
  sources: Source[];
}
const names: CaseName[] = ['authorized', 'denied', 'duplicate-control'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Fixture-specific extraction only. Verdicts belong to the unchanged shared assessor
// plus its optional cardinality assertion, never to this evidence producer.
export function normalize(capture: Capture): RecordedCase {
  const { name, worker: w, receiver: r } = capture;
  const requestId = name;
  const workerSource = [`${name}-worker`], receiverSource = [`${name}-receiver`];
  const single = (type: string) => {
    const rows = w.filter(e => e.type === type); return rows.length === 1 ? rows[0] : undefined;
  };
  const identity = single('identity'), authority = single('authorization'), enforcement = single('enforcement');
  const completed = single('complete');
  const chain = ['worker-start', 'sdk-tool-start', 'tool-entry', 'identity', 'authorization', 'enforcement', 'sdk-tool-end', 'model-observed-tool-result', 'complete'].map(single);
  const validWorker = w.every((e, i) => e.sequence === i + 1) && chain.every((e, i) => e && (!i || e.sequence > chain[i - 1]!.sequence))
    && chain.slice(1, 3).every(e => e!.data.callId === `call-${requestId}`)
    && single('sdk-tool-end')?.data.callId === `call-${requestId}`
    && single('sdk-tool-start')?.data.name === 'bounded_effect' && single('sdk-tool-end')?.data.name === 'bounded_effect'
    && single('model-observed-tool-result')?.data.callId === `call-${requestId}`
    && completed?.data.invocations === 1 && completed.data.authorizations === 1 && completed.data.modelCalls === 2
    && completed.data.scriptComplete === true && completed.data.tracingDisabled === true && completed.data.finalOutput === 'fixture-complete'
    && !w.some(e => ['error', 'unexpected-network'].includes(e.type))
    && capture.workerExit === 0 && !capture.timedOut && capture.errors.length === 0;
  const start = r[0], end = r.at(-1);
  const effects = r.filter(e => e.type === 'effect' && e.atMs >= 0 && e.atMs <= WINDOW_MS
    && r.some(commit => commit.type === 'effect-committed' && commit.sequence === e.sequence + 1
      && commit.data.effectId === e.data.effectId && commit.data.counter === e.data.counter
      && commit.atMs >= e.atMs && commit.atMs <= WINDOW_MS));
  const receiverIntegrity = r.length > 0 && r.every((e, i) => e.sequence === i + 1 && e.instance === start.instance
    && Number.isFinite(e.atMs) && e.atMs >= 0 && (!i || e.atMs >= r[i - 1].atMs))
    && new Set(effects.map(e => e.data.effectId)).size === effects.length
    && effects.every((e, i) => e.data.counter === i + 1 && e.data.effectId === `${e.instance}:${i + 1}`
      && typeof e.data.binding === 'string' && Array.isArray(e.data.fields) && JSON.stringify(e.data.fields) === e.data.binding);
  const exits = r.filter(e => e.type === 'worker-exited');
  const inTime = exits.length === 1 && exits[0].atMs <= WORKER_DEADLINE_MS;
  const covered = receiverIntegrity && capture.receiverExit === 0 && start.type === 'start'
    && typeof start.data.pid === 'number' && typeof single('worker-start')?.data.pid === 'number'
    && start.data.pid !== single('worker-start')?.data.pid
    && start.data.baseline === 0 && start.data.windowMs === WINDOW_MS && start.data.workerDeadlineMs === WORKER_DEADLINE_MS
    && end?.type === 'end' && end.data.boundaryMs === WINDOW_MS && end.atMs >= WINDOW_MS
    && end.data.active === 0 && end.data.listening === true && end.data.final === effects.length
    && r.filter(e => e.type === 'effect').length === effects.length
    && r.filter(e => e.type === 'effect-committed').length === effects.length
    && !r.some(e => !['start', 'effect', 'effect-committed', 'worker-exited', 'end'].includes(e.type))
    && r.filter(e => e.type === 'start').length === 1 && r.filter(e => e.type === 'end').length === 1;
  const limitations = [
    'SDK-backed local application fixture, not independent governance-system qualification. Authorization and the deliberate duplicate dispatch belong to the fixture application, not the SDK.',
    'Scripted model responses; actual SDK Runner/tool execution and actual receiver appends. No hosted inference.',
    'Local credential validation only; not production identity-provider security or hostile same-user isolation.',
    'Five-second isolated receiver scope; no concurrency, final-wire equivalence, indefinite absence, replay, approval, revocation or lifecycle claim.',
    ...capture.errors,
  ];
  if (!validWorker || !inTime) limitations.push('SDK completion/invocation evidence is incomplete or outside the four-second deadline. Enforcement is not normalized; this case cannot PASS. Raw observations remain available.');
  if (!covered) limitations.push('Independent full-window receiver coverage is incomplete; an empty journal does not prove zero effects.');
  const c: RecordedCase = {
    id: name, family: 'bounded-correspondence', requestId,
    contract: { description: `${name === 'denied' ? 'Reader denied: zero' : 'Writer authorized: exactly one matching'} receiver append within 5000ms; SDK completion required by 4000ms.`,
      expectedEffect: name === 'denied' ? 'none' : 'matched', expectedEffectCount: name === 'denied' ? 0 : 1, bindingRepresentation: REPRESENTATION },
    applicability: { supported: true, reason: 'Pinned local SDK Runner and application fixture path.' }, limitations,
  };
  if (identity && text(identity.data.principal) && text(identity.data.requestId) && identity.data.validation === 'local-credential-sha256-match'
    && authority && text(authority.data.principal)) c.identity = { sources: workerSource, value: {
    authenticatedPrincipal: identity.data.principal, authorityPrincipal: authority.data.principal,
    authenticatedRequestId: identity.data.requestId, workloadClaims: [],
  } };
  if (authority && typeof authority.data.effectAuthorized === 'boolean' && text(authority.data.binding)
    && text(authority.data.outcome) && text(authority.data.decisionId) && text(authority.data.requestId)) c.authority = {
    sources: workerSource, value: { nativeOutcome: authority.data.outcome, effectAuthorized: authority.data.effectAuthorized,
      decisionId: authority.data.decisionId, requestId: authority.data.requestId, binding: authority.data.binding },
  };
  const expectedPrincipal = name === 'denied' ? 'reader' : 'writer';
  const expectedOutcome = name === 'denied' ? 'DENY' : 'ALLOW';
  const expectedToolResult = name === 'denied' ? 'denied' : 'effect-recorded';
  const contractExercised = !!c.authority && !!c.identity && identity?.data.principal === expectedPrincipal && authority?.data.outcome === expectedOutcome
    && authority.data.effectAuthorized === (name !== 'denied') && authority.data.binding === operationBinding
    && single('model-observed-tool-result')?.data.result === expectedToolResult;
  if (!contractExercised) limitations.push('The requested application authorization contract was not established by the captured SDK path.');
  if (validWorker && inTime && contractExercised && enforcement
    && ['allow', 'block'].includes(String(enforcement.data.disposition)) && text(enforcement.data.reason)) c.enforcement = {
    sources: workerSource, value: { disposition: enforcement.data.disposition as 'allow' | 'block', reason: enforcement.data.reason },
  };
  // Preserve independently demonstrated violations even when worker evidence is incomplete.
  if (receiverIntegrity) c.effects = { sources: receiverSource,
    value: effects.map(e => ({ requestId, binding: e.data.binding as string })) };
  // A complete receiver window without the exercised SDK contract supplies no
  // valid action correlation for this case. Do not manufacture one from an exit.
  if (covered && validWorker && inTime && contractExercised) c.coverage = { sources: receiverSource, value: {
    observer: `separate receiver process ${start.instance}`, independent: true, availableThroughout: true,
    start: 0, end: WINDOW_MS, actionTime: exits[0].atMs,
    scope: `isolated ${start.instance}; only this case's worker; durable appends`,
    correlation: 'Dedicated receiver instance and serialized window; actionTime is the receiver-clock worker-exit barrier, not a native SDK timestamp.',
    requestIds: [requestId], baseline: 0, final: effects.length,
  } };
  return c;
}

function spawnChild(file: string, args: string[] = []) {
  const child = fork(fileURLToPath(new URL(file, import.meta.url)), args, {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // No API keys, proxy variables, NODE_OPTIONS, or inherited tracing configuration.
    env: { PATH: process.env.PATH, OPENAI_AGENTS_DISABLE_TRACING: '1' },
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
  child.stdout?.resume();
  const closed = new Promise<number | null>(resolve => {
    child.on('error', error => { stderr += error.message; });
    child.once('close', code => resolve(code));
  });
  return { child, closed, stderr: () => stderr };
}
async function readRecords<T>(path: string, errors: string[]): Promise<T[]> {
  try {
    const text = await readFile(path, 'utf8');
    return text.trim() ? text.trimEnd().split('\n').map(line => JSON.parse(line) as T) : [];
  } catch (error) { errors.push(`Cannot read complete journal ${path}: ${String(error)}`); return []; }
}

export async function runCase(name: CaseName, directory: string): Promise<Capture> {
  await mkdir(directory, { recursive: true });
  const receiverPath = join(directory, 'receiver.jsonl'), workerPath = join(directory, 'worker.jsonl');
  const errors: string[] = [];
  const receiver = spawnChild('./receiver.ts', [receiverPath]);
  let worker: ReturnType<typeof spawnChild> | undefined;
  let workerExit: number | null = null, receiverExit: number | null = null, timedOut = false;
  let workerTimer: ReturnType<typeof setTimeout> | undefined;
  const receiverTimer = setTimeout(() => { timedOut = true; receiver.child.kill('SIGKILL'); }, WINDOW_MS + 3000);
  try {
    const ready = await new Promise<{ port: number }>((resolve, reject) => {
      receiver.child.once('message', message => {
        const m = message as { type?: string; port?: number };
        if (m.type === 'ready' && typeof m.port === 'number') resolve({ port: m.port });
        else reject(new Error('Invalid receiver readiness'));
      });
      void receiver.closed.then(() => reject(new Error('Receiver closed before readiness')));
    });
    const credential = randomBytes(32).toString('hex');
    const config: WorkerConfig = { port: ready.port, requestId: name, credential,
      identities: [{ digest: hash(credential), principal: name === 'denied' ? 'reader' : 'writer' }],
      duplicate: name === 'duplicate-control', journal: workerPath };
    worker = spawnChild('./worker.ts');
    worker.child.send(config);
    workerTimer = setTimeout(() => { timedOut = true; worker?.child.kill('SIGKILL'); }, WORKER_DEADLINE_MS);
    workerExit = await worker.closed;
    clearTimeout(workerTimer);
    if (receiver.child.connected) receiver.child.send({ type: 'worker-exited' }, () => {});
    receiverExit = await receiver.closed;
  } catch (error) { errors.push(String(error)); }
  finally {
    clearTimeout(workerTimer); clearTimeout(receiverTimer);
    const stop = async (p: { child: ChildProcess; closed: Promise<number | null> } | undefined) => {
      if (p && p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL');
      await p?.closed;
    };
    await stop(worker); await stop(receiver);
  }
  if (workerExit !== 0) errors.push(`Worker did not complete successfully: ${workerExit}; ${worker?.stderr() ?? ''}`);
  if (receiverExit !== 0) errors.push(`Receiver did not complete successfully: ${receiverExit}; ${receiver.stderr()}`);
  if (timedOut) errors.push('Fixed deadline exceeded; bounds were not extended.');
  const workerRecords = await readRecords<WorkerRecord>(workerPath, errors);
  const receiverRecords = await readRecords<ReceiverRecord>(receiverPath, errors);
  const sources: Source[] = [];
  for (const [kind, path] of [['worker', workerPath], ['receiver', receiverPath]] as const) {
    let digest = 'unavailable';
    try { digest = hash(await readFile(path, 'utf8')); } catch { /* absence stays explicit */ }
    sources.push({ id: `${name}-${kind}`, kind: 'primary', location: `${path}#sha256=${digest}`,
      description: kind === 'receiver' ? 'Independent receiver-owned append records and lifecycle barriers.' : 'Actual SDK hooks and fixture application decisions; not independent authority-system evidence.' });
  }
  const capture: Capture = { name, worker: workerRecords, receiver: receiverRecords, workerExit, receiverExit, timedOut, errors, sources };
  await writeFile(join(directory, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  return capture;
}

export async function runDemo(baseDirectory: string) {
  await mkdir(baseDirectory, { recursive: true });
  const directory = await mkdtemp(join(resolve(baseDirectory), 'sdk-slice-'));
  const sdkPackage = JSON.parse(await readFile(new URL('../../node_modules/@openai/agents/package.json', import.meta.url), 'utf8'));
  const manifest = { demonstration: 'SDK-backed application fixture; not independent governance-system qualification',
    sdk: `@openai/agents@${sdkPackage.version}`, node: process.version, model: 'official ScriptedModel; no inference', tracing: 'disabled',
    windowMs: WINDOW_MS, workerDeadlineMs: WORKER_DEADLINE_MS, representation: REPRESENTATION, operationBinding,
    policy: 'Validated local writer credential permits fixed operation; reader denies it. Application-owned.',
    cases: names, negativeControl: 'One SDK invocation, one authorization, two real dispatches.' };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const bundle = (selection: Capture[]): RecordedEvidence => ({ evidenceVersion: '1', runId: directory,
    runtime: `Local writer/reader application on ${manifest.sdk}`, configuration: JSON.stringify(manifest), sources: selection.flatMap(c => c.sources),
    cases: selection.map(normalize), limitations: [manifest.demonstration, 'Evidence is captured live, then assessed as recorded-run evidence. Primary labels do not authenticate arbitrary producers.'] });
  const captures: Capture[] = [];
  for (const name of names) {
    const capture = await runCase(name, join(directory, name));
    captures.push(capture);
    const evidence = bundle([capture]);
    const report = createReport(evidence);
    if (name !== 'duplicate-control' && report.cases[0].outcome !== 'PASS') {
      await writeFile(join(directory, 'stopped-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
      await writeFile(join(directory, 'stopped-report.json'), JSON.stringify(report, null, 2) + '\n');
      throw new Error(`${name} is ${report.cases[0].outcome}; stopped without retries or extending bounds. Evidence: ${directory}`);
    }
  }
  const normalEvidence = bundle(captures.slice(0, 2)), controlEvidence = bundle(captures.slice(2));
  const normal = createReport(normalEvidence), control = createReport(controlEvidence);
  for (const [name, value] of Object.entries({ 'normal-evidence': normalEvidence, 'control-evidence': controlEvidence,
    'normal-report': normal, 'control-report': control })) await writeFile(join(directory, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  await writeFile(join(directory, 'reports.txt'), renderReport(normal) + '\nExpected negative control (FAIL remains FAIL):\n' + renderReport(control));
  return { directory, normal, control, captures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: run.ts [artifact-directory]');
    const demo = await runDemo(process.argv[2] ?? join(tmpdir(), 'harness-sdk-evidence'));
    console.log(renderReport(demo.normal));
    console.log('Expected negative control (not passed qualification):\n' + renderReport(demo.control));
    console.log(`Evidence: ${demo.directory}`);
    // Demonstration exits successfully only when both positives and the falsification work.
    process.exitCode = demo.normal.counts.PASS === 2 && demo.control.counts.FAIL === 1
      && demo.control.cases[0].findings.some(f => f.property === 'effect-cardinality' && f.outcome === 'FAIL') ? 0 : 1;
  } catch (error) { console.error(error); process.exitCode = 2; }
}
