import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { RecordedCase, RecordedEvidence, Source } from '../evidence.ts';
import { ValidationError } from '../evidence.ts';

// Reviewed translation of sanitized, derived publication fixtures. They retain
// source claims, not raw receiver/authentication evidence or normative runtime policy.
const hashes: Record<string, string> = {"candidate-a": "6c247b236b0afd9816601d62c91b9efee78447745b22ed41f8a90ef5001a7432", "candidate-b": "324c133f6512ccef1e1d8da3612347520b7d1f0165b4b83af01332cd1efb7d14"};
export async function loadCandidateAB(): Promise<RecordedEvidence> {
  const sources: Source[] = [];
  for (const name of ['candidate-a', 'candidate-b']) {
    const relative = `tests/fixtures/recorded-assessment/${name}.md`;
    const content = await readFile(new URL(`../../../${relative}`, import.meta.url));
    if (createHash('sha256').update(content).digest('hex') !== hashes[name]) throw new ValidationError(`${name}: derived publication fixture changed; translation must be reviewed`);
    sources.push({ id: name, location: `${relative}#sha256=${hashes[name]}`, kind: 'summary' as const, description: 'Derived publication fixture of the source experiment report; local machine and evidence-storage locations omitted. Not an unmodified source snapshot; underlying private journals not imported.' });
  }
  const rows: [string, string, 'matched' | 'none'][] = [
    ['exact-operation', 'allow; one matching receiver effect', 'matched'],
    ['spoofed-claims', 'allow; fresh authenticated identity; one matching receiver effect', 'matched'],
    ...['method', 'path', 'query', 'covered-header', 'body'].map(x => [`changed-${x}`, 'deny, unknown tool; zero receiver effects', 'none'] as [string, string, 'none']),
    ['missing-write-evidence', 'constrain; zero receiver effects', 'none'],
    ['low-confidence', 'human_review; zero receiver effects', 'none'],
    ['malformed-response', 'no authority decision; zero receiver effects', 'none'],
    ['deadline', 'no authority decision; zero receiver effects', 'none'],
    ['cde-unavailable', 'no authority decision; zero receiver effects', 'none'],
    ['middleware-stopped', 'no invocation; zero receiver effects', 'none'],
  ];
  const cases: RecordedCase[] = rows.map(([id, fact, expectedEffect]) => ({
    id: `candidate-a/${id}`, family: 'bounded-correspondence',
    contract: { description: 'Candidate A declared bounded HTTP application-operation contract.', expectedEffect, bindingRepresentation: 'kingpin.openshell-operation.v1 (application operation, not final wire bytes)' },
    applicability: { supported: true, reason: 'The source experiment exercised this property.' },
    requestId: `source-case:${id}`, // local locator only, NOT an authenticated native request identity
    enforcement: { value: { disposition: expectedEffect === 'matched' ? 'allow' : 'block', reason: expectedEffect === 'matched' ? 'HTTP 200' : 'HTTP 403' }, sources: ['candidate-a'] },
    reportedFacts: [fact],
    limitations: ['Case locator is not a native request ID. Raw binding/authentication and independent observation records are not included in this public-summary import.'],
  }));
  cases.push({
    id: 'candidate-b/review-fresh-binding', family: 'review-binary-enforcement',
    contract: { description: 'Candidate B declares blocked review, approval alone without dispatch, and no approval transfer to a fresh binding.', expectedEffect: 'none', bindingRepresentation: 'Native identity-bound canonical arguments hash' },
    applicability: { supported: true, reason: 'The source experiment exercised review and fresh-binding consumption.' },
    requestId: '855881ca-7f47-4e88-9a5b-7b9b774ba4ef',
    enforcement: { value: { disposition: 'block', reason: 'kingpin_review_required' }, sources: ['candidate-b'] },
    reportedFacts: ['HUMAN REVIEW remained persistent and distinguishable through binary DENY.',
      'Original request 48cf4916-b89a-4fbd-9783-8d0eada6c662; original review d27aeda1-f423-452e-83a7-ee52689ee508.',
      'Fresh review 31ef97b3-c595-481e-8d66-a78fbc2493bb; same application operation, distinct authenticated request and arguments hash.',
      'Scoped approval: execution_authorized:false, consumed_at:null; separate-process persistence inspection.',
      'Actual fresh captured request consumed against original approval: execution_authorized:false, REQUEST_BINDING_CHANGED; original invalidated, resolution retained, unconsumed.',
      'Receiver reportedly listening throughout bounded probes; zero total effects.'],
    limitations: ['Public summary includes identifiers but not the underlying control, authentication, listener and receiver records needed for independent assessment.'],
  });
  await addNativeObservations(cases, sources);
  return { evidenceVersion: '1', runId: 'candidate-ab-public-records-20261020', runtime: 'CDE/Kingpin with OpenShell 0.1.5-dev.68+g0bfa1e8b0',
    configuration: 'Source reports: HTTP only; sole/final fail-closed middleware; no providers or later mutators.', sources, cases,
    limitations: ['Source-reported PASS is not inherited by this assessment.', 'Allowlisted native observations supplement the public summaries, but full independent bounded observation coverage is not established; missing evidence remains UNVERIFIED.',
      'No live execution, final-wire receipt, certification, exactly-once, cancellation, rollback or indefinitely delayed-effect claim.',
      'No live arbitrary downstream-mutator injection; correspondence depends on the qualified configuration.',
      'Sources: agent-tool-governance-gateway/experiments/openshell-binding/GOVERNANCE-RESULT.md and experiments/openshell-review/RESULT.md.'] };
}

interface NativeRequest {
  authenticated_request_id: string | null;
  authenticated_subject: string | null;
  request_id: string;
  mapped_principal: string;
  authority_principal: string;
  decision_id: string;
  outcome: string;
  operation_sha256: string;
  arguments_hash: string;
  workload_claims: string[];
}
interface NativeExtract {
  origins: { file: string; sha256: string }[];
  a: { status: number; request: NativeRequest | null; receiver: { operation_sha256: string }[] }[];
  b: { original: NativeRequest; fresh: NativeRequest; response_reason: string; response_status: number;
    inspection: { review_id: string; request_id: string; original_outcome: string; arguments_hash: string };
    consumption: { reviewId: string; requestId: string; execution_authorized: boolean; reason: string } };
}
async function addNativeObservations(cases: RecordedCase[], sources: Source[]): Promise<void> {
  const path = 'tests/fixtures/recorded-assessment/candidate-ab-observations.json';
  const bytes = await readFile(new URL(`../../../${path}`, import.meta.url));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== 'd8858273286921846c4e96991f4362722eca55ef88c38d2bd6ab140aab8b4050') throw new ValidationError('Native extract changed; source translation must be reviewed');
  // Hash pins this reviewed, allowlisted fixture; no arbitrary native input is cast.
  const native = JSON.parse(bytes.toString('utf8')) as NativeExtract;
  function reference(id: string, pointer: string) {
    sources.push({ id, location: `${path}#${pointer}`, kind: 'primary', description: `Allowlisted native records, with source row positions. Extract SHA256 ${hash}. Origin-file SHA256 hashes are preserved in the extract.` });
    return [id];
  }
  function attach(c: RecordedCase, r: NativeRequest, refs: string[], binding: string) {
    c.requestId = r.request_id;
    c.authority = { value: { nativeOutcome: r.outcome, effectAuthorized: r.outcome === 'allow', decisionId: r.decision_id, requestId: r.request_id, binding }, sources: refs };
    if (r.authenticated_request_id && r.authenticated_subject) c.identity = { value: {
      authenticatedPrincipal: r.mapped_principal, authorityPrincipal: r.authority_principal,
      authenticatedRequestId: r.authenticated_request_id, workloadClaims: r.workload_claims,
    }, sources: refs };
  }
  native.a.forEach((n, i) => {
    const c = cases[i];
    const refs = reference(`candidate-a-native-${i}`, `/a/${i}`);
    if (n.request) attach(c, n.request, refs, n.request.operation_sha256);
    c.enforcement = { value: { disposition: n.status === 200 ? 'allow' : 'block', reason: `HTTP ${n.status}` }, sources: refs };
    // Source runner serialized event slices. Positive observations are linked by
    // that slice, never by the receiver's untrusted workload request-ID claims.
    if (n.request && n.receiver.length) c.effects = { value: n.receiver.map(r => ({ requestId: n.request!.request_id, binding: r.operation_sha256 })), sources: refs };
    c.limitations = ['Native bindings and positive receiver records are extracted where present. Source runner event slices provide serialized correlation; no independently established full-window observer availability is imported. Zero effects are not inferred from an empty slice.',
      'Request locators remain non-native for fault cases without governance records. Principal mapping is recorded by the authenticated integration; receiver identity claims are not used.'];
  });
  const c = cases[cases.length - 1];
  const b = native.b;
  const refs = reference('candidate-b-native', '/b');
  attach(c, b.fresh, refs, b.fresh.arguments_hash);
  c.enforcement = { value: { disposition: b.response_status === 403 ? 'block' : 'allow', reason: b.response_reason }, sources: refs };
  c.review = { value: {
    nativeState: b.original.outcome, durableState: b.inspection.original_outcome,
    visibleReason: 'kingpin_review_required', originalDecisionId: b.original.decision_id,
    originalRequestId: b.original.request_id, freshRequestId: b.consumption.requestId,
    originalBinding: b.original.arguments_hash, freshBinding: b.fresh.arguments_hash,
    approvedBinding: b.inspection.arguments_hash,
    attemptedApprovalBinding: b.consumption.reviewId === b.inspection.review_id ? b.inspection.arguments_hash : `different-review:${b.consumption.reviewId}`,
    approvalSourceRequestId: b.inspection.request_id, freshExecutionAuthorized: b.consumption.execution_authorized,
  }, sources: refs };
  c.reportedFacts!.push(`Native consumption result: ${b.consumption.reason}`);
  c.limitations = ['Review inspection and fresh-binding refusal are extracted from actual records. Independent full-window receiver availability and zero-effect coverage are not established by this extract. No claim of indefinite absence of effects.'];
}
