import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contractionCases, contractionRegistrations } from '../scenarios/registrations.ts';
import { verifyContraction } from '../src/adapters/kingpin-rc2/h4-check.ts';
import { runApplicable } from '../src/core/applicability.ts';
import { rc2GatewayRuntime } from '../src/adapters/kingpin-rc2/capabilities.ts';

const [scope,revoke,contract] = contractionCases;
type Case = typeof contractionCases[number];
function read(id: Case) {
  const path = new URL('../evidence/h4-sqlite/' + id + '.jsonl',import.meta.url);
  return JSON.parse(readFileSync(path,'utf8').split('\n')[0]).data.evidence.sqliteRotation;
}
for (const id of contractionCases) test('retained ' + id, () => verifyContraction(id,read(id)));
test('CR-03 is excluded from execution',async () => {
  const result = await runApplicable(rc2GatewayRuntime,contractionRegistrations[0],async () => assert.fail('CR-03 executed'));
  assert.equal(result.status,'UNSUPPORTED');
  assert.deepEqual(result.missingCapabilities,['per-agent-permission-override']);
});
const faults: [Case,string,RegExp,(e: ReturnType<typeof read>) => void][] = [
  [revoke,'invalid B',/replacement identity/,e => { e.b.observed.refusal.exchange.transport.principal = null; }],
  [contract,'foreign B',/replacement identity/,e => { e.b.observed.refusal.exchange.transport.principal.principal_id = 'foreign'; }],
  [scope,'original channel still authorized',/authenticated scope/,e => { e.b.observed.refusal.exchange.transport.principal.allowed_contexts = e.a.observed.proposal.transport.principal.allowed_contexts; }],
  [revoke,'revoke omitted',/authorized governance change/,e => { delete e.a.observed.change; }],
  [contract,'detector gate substituted',/trusted gate-2 input/,e => { e.a.observed.change.detector.governance_signal.gate = 1; }],
  [contract,'revocation presented as contraction',/change route/,e => { e.a.observed.change = read(revoke).a.observed.change; }],
  [revoke,'ingress refusal presented as revalidation',/consumption boundary/,e => { e.b.observed.refusal.calls = []; }],
  [scope,'invented consumption entry',/consumption boundary/,e => { e.b.observed.refusal.calls = [{}]; }],
  [contract,'wrong native reason',/native revalidation/,e => { e.b.observed.refusal.calls[0].reason = 'CAPABILITY_REVOKED'; }],
  [scope,'adapter entered and file restored',/adapter invocation/,e => {
    for (const s of [e.b.observed.closing,e.final]) {
      s.calls.push({type:'execute',pid:e.b.exit.pid,operation:JSON.parse(e.b.observed.anchor.bytes)});
      s.observer.push(s.calls[0]);
    }
  }],
  [revoke,'unreadable observer',/observer readiness/,e => { e.b.observed.refusal.after.observer = null; }],
  [scope,'missing B readiness',/durable observer/,e => { for (const s of [e.b.observed.closing,e.final]) s.observer.pop(); }],
  [contract,'stale final sample',/fresh observations/,e => { e.b.observed.refusal.after.seq = e.b.observed.refusal.before.seq; }],
  [revoke,'substituted execute UUID',/original execute binding/,e => { e.b.observed.refusal.exchange.transport.path = read(scope).b.observed.refusal.exchange.transport.path; }],
  [scope,'substituted operation binding',/original review binding/,e => { e.a.observed.pending.binding.tool_id = 'fs.read'; }],
  [contract,'one process reused',/distinct OS processes/,e => { e.b.exit.pid = e.a.exit.pid; }],
  [scope,'reopened database copy',/original database/,e => { for (const s of [e.b.observed.opened,e.b.observed.closing,e.final]) s.database.ino++; }],
  [revoke,'revocation lost on reopen',/reopened governance state/,e => { e.b.observed.opened.revocations = []; }],
];
for (const [id,name,predicate,mutate] of faults) test('offline FAIL: ' + name,() => {
  const evidence = read(id);
  mutate(evidence);
  assert.throws(() => verifyContraction(id,evidence),predicate);
});
