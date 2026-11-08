# Foreign Principal Use of Approved Review — Qualification Closeout

## Result

**PASS** for `approved-review-foreign-principal-ingress-refusal` in one running repository-source Gateway/Kingpin fixture. A’s historical approval gave B no transferable execution authority.

1. Trusted principal A proposed a bounded `fs.write` to `effect.txt`. The Gateway returned HTTP 428 with Kingpin’s native `human_review` decision.
2. A permitted, authenticated reviewer approved A’s review. The approval returned `ready_for_consumption: true` and `execution_authorized: false`. The persisted review was `approved` with `consumed_at: null`.
3. B presented A’s exact serialized operation to A’s original review execution URL using B’s own valid credential. Authentication succeeded as a distinct principal with `runtime.evaluate`. The Gateway checked the request against B’s agent identity and session scope.
4. The Gateway returned HTTP 403 with `{"error":"Forbidden"}` before calling `consumeReview`. A’s review remained approved and unconsumed. B never reached the path that could invalidate it. No execution was observed. The refusal produced no fresh Kingpin authority decision for B, and the Harness did not synthesize a native `DENY`.

## Native Review Legitimacy

Kingpin’s native review validator accepted the pending record, the approval-response record and both persisted approved records read before and after B’s attempt. The portable verifier checks the original envelope’s six fields, recognized capability level, tool and revocation lists, recovery counters and revision. The permitted tool list includes the exact reviewed `fs.write`.

The gate-one low-confidence decision, original review and HUMAN REVIEW audit events agree on the original reason codes, including `LOW_CONFIDENCE_REQUIRES_HUMAN_REVIEW`. The `tool.enforcement.review` hold names A’s `fs.write` and original decision and matches the request and evaluation IDs. These checks followed adversarial findings that consistently rewritten copies could describe a review Kingpin’s own model would reject or a hold for a different decision.

## Adversarial Qualification

Multiple read-only reviews identified false passes in the Harness while the observed runtime behavior remained consistent with the intended refusal. Hardening covered:

- Collapsed or forged resolver identities, missing runtime permission, substituted reviews or bodies, and coherently rewritten contexts and binding hashes.
- Malformed or impossible review states, invalid envelopes or triggers, and enforcement holds attributed to another tool or decision.
- Duplicate or misordered native events, unrelated or synthetic rejection evidence, and contradictory execution IDs, receipts or lifecycle events.
- Stale pre-attempt samples presented as final reads, malformed ledger or audit containers, uninitialized observers, and coherent adapter-call, ledger-growth or filesystem-effect evidence.

The legitimate retained artifact passes. All reproduced actionable false-PASS probes now fail. These findings concerned Harness qualification defects. Generated review and request UUIDs correlate records within a run. Coherently renaming every occurrence offline preserves those joins.

## Evidence

[Retained JSONL artifact](../artifacts/approved-review-foreign-principal-ingress-refusal.rc2-gateway.jsonl) · [SHA-256 sidecar](../artifacts/approved-review-foreign-principal-ingress-refusal.rc2-gateway.jsonl.sha256)

SHA-256 `e65256f1361c477108f192fcd2d48be82c94eb787520a75c786f40934a708631`

The resolver identified B from the credential used on the actual execute POST. B had `runtime.evaluate` and a session disjoint from A’s. The URL carried the original review ID, and the POST reused A’s serialized body. Attempt request `d2c42250-a997-476d-bc85-9fbe8a9c3a66` received HTTP 403 and a native `authentication.rejected` event for B with reason `FORBIDDEN`. The original history and approved record were unchanged. There was no B authority decision, review invalidation, consumption, execution authorization, execution ID or receipt, or `tool.execution.*` lifecycle event.

Zero adapter execute entries were observed during the continuously observed qualification window. Full execution-ledger reads succeeded and were empty. The bounded filesystem target was absent at the retained observation boundaries. Those filesystem samples do not establish continuous filesystem absence or disprove transient activity through an unobserved external path.

## Observation Ordering

Harness collection sequence numbers place the initial ledger, observer and directory reads at 1–3 and the approved/pre-attempt reads at 4–6. B’s HTTP request dispatch was 7 and its completed response was 8. The final ledger, observer and directory reads were 9, 10 and 11, respectively. A copied pre-attempt sample fails the required post-response ordering.

## Validation

| Check | Result |
|---|---|
| Focused verifier suite | 38/38 passed, included in the full unit total |
| Full unit suite | 409/409 passed |
| Integration suite | 13/13 passed |
| Registered Gateway scenarios | 10/10 passed, zero unsupported |
| Typecheck and release smoke | Passed |
| Diff and whitespace checks | Passed |
| Artifact checksum verification | Passed |

## Provenance

| Repository | Base commit | Inventory |
|---|---|---|
| Harness | `6b6cf2d10f0a3e02741655408d2826c8ac978131` | 120 file hashes |
| Gateway/Kingpin | `c3095154c757b8fd699448b691a9b3341acd3412` | 469 runtime/resource file hashes |

Both repositories were recorded as dirty. The artifact retains changed-file lists, and the before/after inventories matched. A dirty checkout alone does not establish a tracked Kingpin production-source change. The run used repository source on Darwin arm64, Node v24.14.1 and SQLite 3.51.2. Standalone npm-package certification is outside this evidence. Generated UUIDs provide correlation, without cryptographic execution attestation.

## Scope / Non-Claims

**Qualified:** one running repository-source fixture, distinct trusted A/B principals and scopes, B permitted to reach runtime authorization, A’s legitimate approved and unconsumed review, B’s exact presentation of A’s original `fs.write`, and Gateway ingress refusal before consumption. The execution claim covers zero observed adapter executions, empty accounting and target absence at the sampled filesystem boundaries.

**Outside scope:** the inner `consumeReview` foreign-owner guard, fresh Kingpin policy evaluation for B, same-principal credential rotation, delegation, restart, model replacement, generalized identity-transfer correctness, arbitrary tools or effects, cryptographic execution attestation and standalone npm-package certification.

## Production Impact

No Kingpin production code changed for this qualification, and no Kingpin production defect was exposed. All hardening changes were confined to the Harness scenario, evidence collection and qualification checks.
