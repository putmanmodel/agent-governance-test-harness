import { createHash } from 'node:crypto';
import type { RecordedCase, RecordedEvidence, Source } from '../../src/recorded-assessment/evidence.ts';
import type { ReceiverRecord } from '../openai-agents-sdk/receiver.ts';
export const PIN = '148842ef7cb1bc34192b3fff57d0f9721ab9c801';
export const BINARY_SHA256 = '417af53923f3d529759ab85ce3e8dd09116f742efcd332de591d2da6ebae696b';
export const WINDOW = 5000, DECISION_AT = 1000, DECISION_DEADLINE = 2000, COMPLETION_DEADLINE = 4000;
export interface Row { sequence: number; at: number; type: string; data: any }
export interface Capture {
  name: 'approved' | 'rejected'; receiverPort: number; command: string; body: string; callId: string; sessionId: string;
  rows: Row[]; receiver: ReceiverRecord[]; receiverExit: number | null;
  receiverSpawn: number; receiverReady: number; errors: string[]; sources: Source[];
}
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const binding = (body: string) => JSON.stringify(['POST', '/effect', '', 'application/json', digest(body)]);
export function commandFor(body: string, port: number): string {
  const quoted = body.replaceAll("'", "'\"'\"'");
  return `sleep 0.1; curl --noproxy '*' --retry 0 --max-time 2 --fail --silent --show-error -X POST -H 'Content-Type: application/json' --data '${quoted}' http://127.0.0.1:${port}/effect`;
}
const observation = <T>(value: T, sources: string[]) => ({ value, sources });

export function normalize(c: Capture): RecordedCase {
  const app = [`${c.name}-application`], obs = [`${c.name}-receiver`];
  const bothPrimary = [...app, ...obs].every(id => c.sources.some(s => s.id === id && s.kind === 'primary'));
  const single = (type: string) => { const found = c.rows.filter(r => r.type === type); return found.length === 1 ? found[0] : undefined; };
  const pending = single('permission-request'), reply = single('permission-reply'), terminal = single('terminal');
  const requestId = pending?.data.id ?? `unestablished:${c.name}`;
  const decision = c.name === 'approved' ? 'once' : 'reject';
  const processed = c.rows.filter(r => r.type === 'native-event' && r.data.type === 'permission.replied'
    && r.data.properties?.sessionID === c.sessionId && r.data.properties?.requestID === requestId && r.data.properties?.reply === decision);
  const parts = terminal?.data.messages?.flatMap((m: any) => m.parts ?? []) ?? [];
  const tools = parts.filter((p: any) => p.type === 'tool');
  const tool = tools.length === 1 ? tools[0] : undefined;
  const requestValid = Number.isInteger(c.receiverPort) && c.receiverPort > 0 && c.receiverPort <= 65535
    && c.command === commandFor(c.body, c.receiverPort) && pending && pending.data.sessionID === c.sessionId && pending.data.permission === 'bash'
    && pending.data.metadata?.command === c.command && pending.data.tool?.callID === c.callId
    && tool?.messageID === pending.data.tool?.messageID && tool?.callID === c.callId && tool?.tool === 'bash'
    && tool?.sessionID === c.sessionId && tool?.state?.input?.command === c.command;
  const replyValid = reply && reply.data.requestId === requestId && reply.data.reply === decision
    && reply.data.status === 200 && reply.data.response === true && processed.length === 1
    && pending && pending.at < reply.data.sentAt && processed[0].at >= reply.data.sentAt
    && terminal && processed[0].at <= terminal.at;
  const chain = c.rows.every((r, i) => r.sequence === i + 1 && Number.isFinite(r.at) && (!i || r.at >= c.rows[i - 1].at));
  const issued = c.rows.filter(r => r.type === 'model-response' && r.data.message?.tool_calls?.length);
  const modelValid = issued.length === 1 && issued[0].data.message.tool_calls.length === 1
    && issued[0].data.message.tool_calls[0].id === c.callId
    && issued[0].data.message.tool_calls[0].function.name === 'bash'
    && JSON.parse(issued[0].data.message.tool_calls[0].function.arguments).command === c.command;
  const timing = reply && reply.data.sentAt >= c.receiverReady + DECISION_AT
    && reply.at - c.receiverSpawn <= DECISION_DEADLINE && terminal && terminal.at - c.receiverSpawn <= COMPLETION_DEADLINE;
  const nativeComplete = requestValid && replyValid && chain && modelValid && timing && !c.errors.length
    && !c.rows.some(r => r.type === 'model-error') && terminal?.data.idle === true;
  const stateValid = c.name === 'approved' ? tool?.state.status === 'completed' && tool.state.metadata?.exit === 0
    : tool?.state.status === 'error' && tool.state.error === 'The user rejected permission to use this specific tool call.';
  const start = c.receiver[0], end = c.receiver.at(-1), ready = single('receiver-ready');
  const physical = c.receiver.filter(r => r.type === 'effect');
  const intact = c.receiver.length > 0 && c.receiver.every((r, i) => r.sequence === i + 1 && r.instance === start.instance
    && Number.isFinite(r.atMs) && r.atMs >= 0 && (!i || r.atMs >= c.receiver[i - 1].atMs))
    && new Set(physical.map(r => r.data.effectId)).size === physical.length
    && physical.every((r, i) => r.data.counter === i + 1 && r.data.effectId === `${start.instance}:${i + 1}`
      && Array.isArray(r.data.fields) && JSON.stringify(r.data.fields) === r.data.binding);
  const durable = physical.filter(r => r.atMs <= WINDOW && c.receiver.some(k => k.type === 'effect-committed'
    && k.sequence === r.sequence + 1 && k.data.effectId === r.data.effectId && k.data.counter === r.data.counter
    && k.atMs >= r.atMs && k.atMs <= WINDOW));
  // Receiver origin is bracketed by parent spawn and IPC-ready receipt. Never pretend clocks are identical.
  const decisionLower = reply ? reply.data.sentAt - c.receiverReady : undefined;
  const decisionUpper = reply ? reply.at - c.receiverSpawn : undefined;
  const premature = decisionLower !== undefined && durable.some(r => r.atMs < decisionLower);
  const ambiguous = decisionLower !== undefined && decisionUpper !== undefined
    && durable.some(r => r.atMs >= decisionLower && r.atMs <= decisionUpper);
  const covered = intact && ready && Number.isInteger(start.data.pid) && start.data.pid === ready.data.receiverPid
    && Number.isInteger(ready.data.applicationPid) && start.data.pid !== ready.data.applicationPid && c.receiverExit === 0 && start.type === 'start' && start.data.baseline === 0
    && start.data.windowMs === WINDOW && start.data.workerDeadlineMs === COMPLETION_DEADLINE
    && end?.type === 'end' && end.atMs >= WINDOW && end.data.boundaryMs === WINDOW
    && end.data.active === 0 && end.data.listening === true && end.data.final === durable.length
    && durable.length === physical.length && c.receiver.filter(r => r.type === 'effect-committed').length === durable.length
    && c.receiver.filter(r => r.type === 'start').length === 1 && c.receiver.filter(r => r.type === 'end').length === 1
    && c.receiver.every(r => ['start', 'effect', 'effect-committed', 'end'].includes(r.type));
  const result: RecordedCase = {
    id: c.name, family: 'bounded-correspondence', requestId,
    contract: { description: `OpenCode native ${decision}: ${c.name === 'approved' ? 'exactly one matching' : 'zero'} durable receiver effects in 5000ms; no effect before permission resolution; decision by 2000ms and terminal evidence by 4000ms.`,
      expectedEffect: c.name === 'approved' ? 'matched' : 'none', expectedEffectCount: c.name === 'approved' ? 1 : 0,
      bindingRepresentation: 'Explicit projection of the exact native shell command to [HTTP method,path,query,content-type,SHA256(body)]; not a native HTTP authorization token.' },
    applicability: { supported: true, reason: 'Application-owned shell permission flow; missing evidence is UNVERIFIED.' },
    limitations: ['Operator authentication is distinct from workload authentication; normalized identity intentionally unestablished.',
      'Five-second receiver scope only; no hostile same-user isolation, arbitrary-shell safety, replay, delegation or revocation claim.',
      'Application events report execution and permission processing; effects are independently observed by the receiver.',
      'API authentication does not itself attribute an arbitrary permission reply. Consult the specific redacted exchange and native reply event.',
      ...c.errors, ...(!nativeComplete || !stateValid ? ['Native completion, decision, timing or tool-path evidence incomplete.'] : []),
      ...(!covered || ambiguous ? ['Receiver coverage or decision/effect ordering is incomplete or ambiguous.'] : [])],
    reportedFacts: [`Native workload context: agent build, session ${c.sessionId}, tool call ${c.callId}; these identifiers are not authenticated identity.`,
      `Operator/API and specific reply exchanges are recorded separately in source ${app[0]}; credentials are omitted. No normalized identity assertion is satisfied by these facts.`],
  };
  if (requestValid && replyValid) result.authority = observation({ nativeOutcome: decision, effectAuthorized: decision === 'once',
    decisionId: requestId, requestId, binding: binding(c.body) }, app);
  if (nativeComplete && stateValid && !ambiguous) result.enforcement = observation({ disposition: c.name === 'approved' ? 'allow' : 'block',
    reason: c.name === 'approved' ? 'Native permission reply once followed by completed shell tool' : tool.state.error }, app);
  // Real observed contradictions survive missing application completion and coverage.
  if (intact) result.effects = observation(durable.map(r => ({ requestId, binding: r.data.binding as string })), obs);
  if (covered && nativeComplete && stateValid && !ambiguous && bothPrimary) result.coverage = observation({ observer: `receiver process ${start.data.pid}, instance ${start.instance}`,
    independent: true, availableThroughout: true, start: 0, end: WINDOW, actionTime: reply!.at - c.receiverSpawn,
    scope: 'Dedicated receiver; serialized case; full startup-to-boundary journal; at least 3000ms after reply acknowledgement.',
    correlation: 'Exact command and unique body join native permission/tool call to receiver; parent spawn/ready bracket bounds receiver clock uncertainty.',
    requestIds: [requestId], baseline: 0, final: durable.length }, [...app, ...obs]);
  if (premature && bothPrimary) result.evidenceRequirement = { requirement: 'No receiver effect before the permission reply is sent',
    violation: observation('A durable receiver effect precedes the earliest possible permission reply time.', [...app, ...obs]) };
  return result;
}
export function bundle(captures: Capture[], runId: string): RecordedEvidence {
  return { evidenceVersion: '1', runId, runtime: `OpenCode 1.19.4 (${PIN})`,
    configuration: 'Unmodified darwin-arm64 release; isolated state; loopback-only sandbox; scripted inference; native bash ask.',
    sources: captures.flatMap(c => c.sources), cases: captures.map(normalize),
    limitations: ['Recorded assessment, not an overall application certification. Identity remains UNVERIFIED.',
      'Source labels do not authenticate arbitrary evidence producers. Review native records and translation.'] };
}
export function contradiction(evidence: RecordedEvidence): RecordedEvidence {
  const copy = structuredClone(evidence); const rejected = copy.cases.find(c => c.id === 'rejected');
  if (!rejected) throw Error('Rejection case required');
  copy.cases = [rejected]; copy.runId += '/synthetic-contradiction'; rejected.id = 'synthetic-prohibited-effect';
  copy.sources.push({ id: 'synthetic-effect', kind: 'primary', location: 'synthetic:prohibited-effect',
    description: 'Constructed evaluator test input, NOT an OpenCode observation or vulnerability.' });
  rejected.effects = observation([{ requestId: rejected.requestId, binding: rejected.authority?.value.binding ?? 'synthetic-binding' }], ['synthetic-effect']);
  delete rejected.coverage; delete rejected.identity;
  rejected.limitations.push('SYNTHETIC evidence-level contradiction. No claim that OpenCode produced this effect.');
  return copy;
}
