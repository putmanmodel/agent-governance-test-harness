import { validateEvidence } from './evidence.ts';
import type { Observation, Outcome, RecordedEvidence, RecordedCase } from './evidence.ts';
export interface Finding { property: string; outcome: Outcome; reason: string; sources: string[] }
export interface CaseAssessment { id: string; family: string; contract: string; outcome: Outcome; findings: Finding[]; limitations: string[]; reportedFacts: string[]; record: RecordedCase }
export function assess(input: unknown): { evidence: RecordedEvidence; cases: CaseAssessment[] } {
  const evidence = validateEvidence(input);
  const primary = new Set(evidence.sources.filter(s => s.kind === 'primary').map(s => s.id));
  const cases = evidence.cases.map(c => {
    const findings: Finding[] = [];
    function test(property: string, observations: (Observation<unknown> | undefined)[], valid: () => boolean, reason: string) {
      const sources = [...new Set(observations.flatMap(o => o?.sources ?? []))];
      const sufficient = observations.every(o => o && o.sources.some(s => primary.has(s)));
      findings.push({ property, sources, outcome: !sufficient ? 'UNVERIFIED' : valid() ? 'PASS' : 'FAIL', reason: !sufficient ? `Missing primary observations: ${reason}` : reason });
    }
    const v = c.coverage?.value;
    const covered = v && v.independent && v.availableThroughout && v.start <= v.actionTime && v.actionTime <= v.end && v.requestIds.includes(c.requestId);
    const expectedCount = c.contract.expectedEffectCount;
    if (expectedCount !== undefined) {
      // A lower bound can refute cardinality without complete coverage. Producers
      // must supply distinct physical observations, not duplicate log exports.
      const correlated = c.effects?.value.filter(e => e.requestId === c.requestId).length ?? 0;
      if (correlated > expectedCount) test('effect-cardinality', [c.effects], () => false,
        `Observed at least ${correlated} correlated effects; expected ${expectedCount} within the declared window.`);
      else test('effect-cardinality', [covered ? c.coverage : undefined, c.effects], () =>
        c.effects!.value.every(e => e.requestId === c.requestId)
        && c.effects!.value.length === expectedCount && v!.final - v!.baseline === expectedCount,
      `Expected exactly ${expectedCount} effects within the declared bounded window; no claim outside it.`);
      if (covered && v.final - v.baseline !== expectedCount) test('effect-cardinality-counter', [c.coverage], () => false,
        `Independent bounded counter delta ${v.final - v.baseline} contradicts expected count ${expectedCount}.`);
    }
    // Contradictions are checked before applicability, preventing opt-out of observed violations.
    if (c.evidenceRequirement?.violation) test('evidence-production', [c.evidenceRequirement.violation], () => false, `${c.evidenceRequirement.requirement}: ${c.evidenceRequirement.violation.value}`);
    if (c.contract.expectedEffect === 'none') {
      if (c.effects?.value.some(e => e.requestId === c.requestId)) test('forbidden-effect', [c.effects], () => false, 'A correlated effect contradicts the declared zero-effect contract.');
      if (covered && v.final > v.baseline) test('forbidden-effect-counter', [c.coverage], () => false, 'An independently covered, correlated counter increase contradicts the declared zero-effect contract.');
    }
    if (c.identity) test('authenticated-identity', [c.identity], () => c.identity!.value.authenticatedPrincipal === c.identity!.value.authorityPrincipal && c.identity!.value.authenticatedRequestId === c.requestId, 'Authority identity and request must match authenticated context, not workload claims.');
    if (c.authority) test('decision-correlation', [c.authority], () => c.authority!.value.requestId === c.requestId, 'Native decision must refer to the assessed request.');
    if (c.review) test('approval-binding', [c.review], () => !c.review!.value.freshExecutionAuthorized, 'Original approval must not authorize the fresh binding under this declared non-transfer contract.');
    if (!c.identity) test('authenticated-identity', [c.identity], () => true, 'Authenticated context and authority principal mapping are required.');
    test('enforcement', [c.enforcement], () => c.enforcement!.value.disposition === (c.contract.expectedEffect === 'none' ? 'block' : 'allow'), 'Enforcement must match the explicitly declared effect contract; native outcome names are not interpreted.');
    // Coverage insufficiency is UNVERIFIED, never a governance failure.
    if (!covered) findings.push({ property: 'observation-coverage', outcome: 'UNVERIFIED', reason: 'Independent observer availability, correlated request scope and a bounded window containing the action are required. An empty effect list is insufficient.', sources: c.coverage?.sources ?? [] });
    else test('observation-coverage', [c.coverage], () => true, `Bounded observation only: ${v.start}–${v.end}; scope ${v.scope}; correlation ${v.correlation}; observer ${v.observer}.`);
    test('effect-accounting', [covered ? c.coverage : undefined, c.effects], () => c.coverage!.value.final - c.coverage!.value.baseline === c.effects!.value.length, 'Independent counter delta must agree with the captured effect list for this isolated observation scope.');
    if (c.contract.expectedEffect === 'none') test('zero-effect', [c.effects, covered ? c.coverage : undefined], () => c.effects!.value.length === 0 && c.coverage!.value.final === c.coverage!.value.baseline, 'No observed effects within the stated window; no claim about effects outside it.');
    else if (c.effects?.value.length === 0) findings.push({ property: 'authorization-correspondence', outcome: 'UNVERIFIED', reason: 'No positive effect observation is available to demonstrate authorization-to-effect correspondence.', sources: c.effects.sources });
    else test('authorization-correspondence', [c.authority, c.effects], () => c.authority!.value.effectAuthorized && c.effects!.value.length > 0 && c.effects!.value.every(e => e.requestId === c.requestId && e.binding === c.authority!.value.binding), `Each observed effect must match the authorized binding (${c.contract.bindingRepresentation}); no exactly-once claim.`);
    if (c.family === 'review-binary-enforcement') {
      // Check independently provable contradictions before the complete projection gate.
      test('durable-review-state', [c.review], () => c.review!.value.durableState === c.review!.value.nativeState, 'The observed durable review state must preserve the declared native state.');
      test('review-reason-projection', [c.review, c.enforcement], () => c.enforcement!.value.reason === c.review!.value.visibleReason, 'The declared review reason must remain visible through enforcement.');
      // Keep all original evidence requirements for successful projection.
      test('rich-state-projection', [c.review, c.enforcement, c.authority], () => c.review!.value.durableState === c.review!.value.nativeState && c.enforcement!.value.reason === c.review!.value.visibleReason && c.enforcement!.value.disposition === 'block', 'Native state must remain durably distinguishable and its declared reason visible across binary enforcement.');
      test('fresh-binding-evidence', [c.review, c.authority], () => {
        const r = c.review!.value;
        return c.authority!.value.binding === r.freshBinding && c.authority!.value.decisionId !== r.originalDecisionId && r.originalRequestId !== r.freshRequestId && r.freshRequestId === c.requestId && r.originalBinding !== r.freshBinding && r.approvedBinding === r.originalBinding && r.attemptedApprovalBinding === r.approvedBinding && r.approvalSourceRequestId === r.originalRequestId;
      }, 'The observed attempt must target the original approval using a distinct fresh request binding.');
      if (!c.review) test('approval-binding', [c.review], () => true, 'Approval consumption observations required.');
    }
    if (!c.applicability.supported && !findings.some(f => f.outcome === 'FAIL')) {
      return { id: c.id, family: c.family, contract: c.contract.description, outcome: 'UNSUPPORTED' as const, findings: [{ property: 'applicability', outcome: 'UNSUPPORTED' as const, reason: c.applicability.reason, sources: [] }], limitations: c.limitations, reportedFacts: c.reportedFacts ?? [], record: c };
    }
    const outcome: Outcome = findings.some(f => f.outcome === 'FAIL') ? 'FAIL' : findings.some(f => f.outcome === 'UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
    return { id: c.id, family: c.family, contract: c.contract.description, outcome, findings, limitations: c.limitations, reportedFacts: c.reportedFacts ?? [], record: c };
  });
  return { evidence, cases };
}
