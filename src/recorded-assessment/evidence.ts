/** Recorded observations, not runtime policy or a live execution protocol. */
export type Family = 'bounded-correspondence' | 'review-binary-enforcement';
export type Outcome = 'PASS' | 'FAIL' | 'UNSUPPORTED' | 'UNVERIFIED';
export interface Source { id: string; location: string; kind: 'primary' | 'summary'; description: string }
export interface Observation<T> { value: T; sources: string[] }
export interface RecordedCase {
  id: string;
  family: Family;
  contract: { description: string; expectedEffect: 'matched' | 'none'; bindingRepresentation: string; expectedEffectCount?: 0 | 1 };
  applicability: { supported: boolean; reason: string };
  requestId: string;
  // Native vocabulary is opaque. No decision is inferred from an enforcement block.
  authority?: Observation<{ nativeOutcome: string; effectAuthorized: boolean; decisionId: string; requestId: string; binding: string }>;
  enforcement?: Observation<{ disposition: 'allow' | 'block'; reason: string }>;
  identity?: Observation<{ authenticatedPrincipal: string; authorityPrincipal: string; authenticatedRequestId: string; workloadClaims: string[] }>;
  effects?: Observation<{ requestId: string; binding: string }[]>;
  coverage?: Observation<{ observer: string; independent: boolean; availableThroughout: boolean; start: number; end: number; actionTime: number; scope: string; correlation: string; requestIds: string[]; baseline: number; final: number }>;
  review?: Observation<{ nativeState: string; durableState: string; visibleReason: string; originalDecisionId: string; originalRequestId: string; freshRequestId: string; originalBinding: string; freshBinding: string; approvedBinding: string; attemptedApprovalBinding: string; approvalSourceRequestId: string; freshExecutionAuthorized: boolean }>;
  // Only an observed breach of an explicitly declared evidence-production contract is FAIL.
  evidenceRequirement?: { requirement: string; violation?: Observation<string> };
  reportedFacts?: string[];
  limitations: string[];
}
export interface RecordedEvidence {
  evidenceVersion: '1';
  runId: string;
  runtime: string;
  configuration: string;
  sources: Source[];
  cases: RecordedCase[];
  limitations: string[];
}

export class ValidationError extends Error {}
// Small closed structural validator for this one input format; no schema framework.
type Shape = 'string' | 'number' | 'boolean' | readonly string[] | { array: Shape } | { fields: Record<string, Shape> };
const obj = (fields: Record<string, Shape>): Shape => ({ fields });
const arr = (array: Shape): Shape => ({ array });
const obs = (value: Shape): Shape => obj({ value, sources: arr('string') });
const shape = obj({
  evidenceVersion: ['1'], runId: 'string', runtime: 'string', configuration: 'string',
  sources: arr(obj({ id: 'string', location: 'string', kind: ['primary', 'summary'], description: 'string' })),
  limitations: arr('string'),
  cases: arr(obj({
    id: 'string', family: ['bounded-correspondence', 'review-binary-enforcement'],
    contract: obj({ description: 'string', expectedEffect: ['matched', 'none'], bindingRepresentation: 'string', 'expectedEffectCount?': 'number' }),
    applicability: obj({ supported: 'boolean', reason: 'string' }), requestId: 'string', limitations: arr('string'), 'reportedFacts?': arr('string'),
    'authority?': obs(obj({ nativeOutcome: 'string', effectAuthorized: 'boolean', decisionId: 'string', requestId: 'string', binding: 'string' })),
    'enforcement?': obs(obj({ disposition: ['allow', 'block'], reason: 'string' })),
    'identity?': obs(obj({ authenticatedPrincipal: 'string', authorityPrincipal: 'string', authenticatedRequestId: 'string', workloadClaims: arr('string') })),
    'effects?': obs(arr(obj({ requestId: 'string', binding: 'string' }))),
    'coverage?': obs(obj({ observer: 'string', independent: 'boolean', availableThroughout: 'boolean', start: 'number', end: 'number', actionTime: 'number', scope: 'string', correlation: 'string', requestIds: arr('string'), baseline: 'number', final: 'number' })),
    'review?': obs(obj({ nativeState: 'string', durableState: 'string', visibleReason: 'string', originalDecisionId: 'string', originalRequestId: 'string', freshRequestId: 'string', originalBinding: 'string', freshBinding: 'string', approvedBinding: 'string', attemptedApprovalBinding: 'string', approvalSourceRequestId: 'string', freshExecutionAuthorized: 'boolean' })),
    'evidenceRequirement?': obj({ requirement: 'string', 'violation?': obs('string') }),
  })),
});
function check(value: unknown, spec: Shape, path: string): void {
  const bad = (why: string): never => { throw new ValidationError(`${path}: ${why}`); };
  if (typeof spec === 'string') {
    if (typeof value !== spec || (spec === 'number' && !Number.isFinite(value)) || (spec === 'string' && !(value as string).trim())) bad(`expected nonempty ${spec}`);
  } else if (Array.isArray(spec)) {
    if (!spec.includes(value as string)) bad(`expected ${spec.join(' | ')}`);
  } else if ('array' in spec) {
    if (!Array.isArray(value)) bad('expected array');
    (value as unknown[]).forEach((v, i) => check(v, spec.array, `${path}[${i}]`));
  } else if ('fields' in spec) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('expected object');
    const record = value as Record<string, unknown>;
    const allowed = Object.keys(spec.fields).map(k => k.replace(/\?$/, ''));
    for (const key of Object.keys(record)) if (!allowed.includes(key)) bad(`unknown field ${key}`);
    for (const [key, child] of Object.entries(spec.fields)) {
      const name = key.replace(/\?$/, '');
      if (key.endsWith('?') && !(name in record)) continue;
      check(record[name], child, `${path}.${name}`);
    }
  }
}
export function validateEvidence(input: unknown): RecordedEvidence {
  check(input, shape, 'evidence');
  const data = input as RecordedEvidence;
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new ValidationError(`duplicate ${label}`);
  };
  unique(data.sources.map(s => s.id), 'source ID');
  unique(data.cases.map(c => c.id), 'case ID');
  if (!data.cases.length) throw new ValidationError('at least one case required');
  const ids = new Set(data.sources.map(s => s.id));
  function refs(v: unknown): void {
    if (!v || typeof v !== 'object') return;
    if ('value' in v && 'sources' in v) {
      const references = v.sources as string[];
      if (!references.length || references.some(id => !ids.has(id))) throw new ValidationError('observation requires known source references');
    }
    for (const child of Object.values(v)) refs(child);
  }
  refs(data.cases);
  for (const c of data.cases) {
    const count = c.contract.expectedEffectCount;
    if (count !== undefined && (count !== 0 && count !== 1 || count !== (c.contract.expectedEffect === 'none' ? 0 : 1))) {
      throw new ValidationError(`${c.id}: expectedEffectCount must be 0 for none or 1 for matched`);
    }
    const v = c.coverage?.value;
    if (v && (v.start >= v.end || v.baseline < 0 || v.final < v.baseline || !Number.isInteger(v.baseline) || !Number.isInteger(v.final))) throw new ValidationError(`${c.id}: invalid observation interval/counters`);
  }
  return data;
}
