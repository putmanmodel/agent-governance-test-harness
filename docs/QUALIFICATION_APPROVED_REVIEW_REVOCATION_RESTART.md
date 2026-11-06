# Approved Review Revocation Across Restart — Qualification Closeout

## Result

**PASS** for `approved-review-revocation-survives-restart`, limited to the tested Gateway/Kingpin path and bounded sandbox operation.

The retained experiment establishes this sequence:

1. A bounded `fs.write` operation receives a legitimate HUMAN REVIEW decision.
2. The authenticated reviewer approves the review; it is ready for consumption but remains unconsumed and does not yet authorize execution.
3. The matching write capability is revoked before execution.
4. Process A exits gracefully.
5. Process B reopens the same persisted SQLite governance state and sandbox.
6. The identical request bound to the original review is presented to its `/execute` endpoint.
7. Execution is refused with HTTP `403` and `CAPABILITY_REVOKED`.
8. Historical approval remains preserved; the review becomes `invalidated`, with `consumed_at: null` and execution eligibility false.
9. No bounded execution or effect is observed in the qualification window.

Historical approval is not current authority. Restart did not restore the revoked capability. The initial native HUMAN REVIEW remains represented as `INDETERMINATE`; the Harness does not fabricate a fresh native DENY decision. The post-restart refusal is established through compound response, review-state, audit, accounting, and independent observation evidence.

## Adversarial Qualification

The first implementation produced the expected runtime behavior, but a separate adversarial review demonstrated false-PASS paths in the qualification machinery. Hardening addressed:

- coherently altered duplicated request copies and coherently corrupted binding hashes;
- a wrong operation with a recomputed binding;
- missing, contradictory, or miscorrelated initial native authority audit;
- malformed length-like evidence containers;
- contradictory Harness execution records;
- zero-effect mutations masked by broader snapshot equality;
- invalidation state/audit disagreement;
- an uninitialized observer being indistinguishable from zero observed calls.

These were Harness qualification defects, not demonstrated Kingpin runtime defects. After hardening, the probes were rerun: the legitimate retained artifact PASSes, and the demonstrated false-PASS artifacts now FAIL. The four isolated zero-effect mutations each fail their dedicated predicate; removing only that predicate makes the same mutation pass.

## Evidence

- Artifact: [approved-review-revocation-survives-restart.rc2-gateway.jsonl](../artifacts/approved-review-revocation-survives-restart.rc2-gateway.jsonl)
- Provenance: [approved-review-revocation-survives-restart.rc2-gateway.provenance.json](../artifacts/approved-review-revocation-survives-restart.rc2-gateway.provenance.json)
- Artifact SHA-256: `ca17cd27fd88e05ac3d52f2eb7d641ef1df3217e5a9e81d9b8f2012c91084870`

The original review was invalidated after failed post-restart consumption (`403 / CAPABILITY_REVOKED`). Historical approval fields remain intact, `consumed_at` remains null, and no execution ID or receipt was returned. The retained history contains no `review.execution_authorized`, `review.execution_consumed`, or `tool.execution.*` lifecycle event.

Execution-ledger snapshots remain empty. Independent filesystem observations show the bounded target absent. The Harness-owned observer journal was initialized in both child lifetimes and contains readiness records but zero execute-call records, including at final inspection after B exited.

Execution accounting is distinct from external effect evidence. No single absence establishes zero effects: the conclusion combines refusal/invalidation, native lifecycle history, direct SQLite ledger inspection, adapter-entry observations, and independent target inspection over the bounded observation window.

## Validation

The hardening validation recorded:

- 371/371 unit tests passed, including the 49 focused qualification tests;
- 12/12 integration tests passed;
- 9/9 registered Gateway scenarios passed;
- typecheck passed;
- release smoke passed;
- diff/whitespace checks passed.

These are validation results for the completed qualification tranche, not a claim that every supported runtime or environment was tested.

### Clean publication-branch reproduction

The qualification commits were also replayed independently onto the then-current public `origin/main` without the separate recorded-assessment tranche. In that isolated worktree:

- 215/215 unit tests passed;
- 12/12 connected integration tests passed with `RC2_ROOT` explicitly pointing to the qualified Kingpin/Gateway checkout;
- `approved-review-revocation-survives-restart` reproduced its PASS directly;
- typecheck passed after installing the lockfile-defined development dependencies;
- release smoke passed on its available static/unconnected checks.

The lower unit-test count reflects the intentionally smaller public-main test surface and does not replace or reinterpret the retained 371/371 qualification run.

## Provenance

The retained run recorded:

| Item | Recorded value |
| --- | --- |
| Harness base commit | `f8dc1706205ae689fbce7f135e339beb6fc9f87a` |
| Harness working state | Dirty state and explicit changed-file list; 115 source/test file hashes |
| Kingpin runtime source | Repository source at `/Users/stephenaputmanjr/Desktop/agent-tool-governance-gateway` |
| Kingpin commit | `c3095154c757b8fd699448b691a9b3341acd3412` |
| Runtime inventory | 469 runtime/resource/dependency file hashes, compared across both child lifetimes |
| Node | 24.14.1 |
| Platform | Darwin arm64 |
| SQLite | 3.51.2 |
| Python | Interpreter identity/hash and installed distribution versions retained in the manifest |
| Run identity | Scenario identifier, historical adapter identity, repository-source loading, and final artifact hash |

The Kingpin repository was dirty because of pre-existing untracked qualification material; tracked production source was unchanged. The inventory is a retained superset of relevant files, not a claim that every inventoried file executed.

The completed qualification tranche was subsequently committed as **`e8f4435` — `test(harness): qualify revocation across restart`**. The retained run did not occur from clean commit `e8f4435`: its provenance remains the earlier Harness base commit plus dirty-state and file-hash evidence. The sidecar binds the final artifact hash without a circular self-hash inside the artifact.

## Public SDK Relationship

The experiment loaded Kingpin/Gateway from repository source. All 17 runtime JS/SQL/default-policy components in the comparison matched the retained public `kingpin-runtime@0.1.0-rc.3` archive and its pinned digest. This establishes component equivalence for those runtime files; it does **not** make this repository-based Gateway experiment a standalone npm-package certification.

The historical `kingpin-rc2` adapter name and `.rc2-gateway.jsonl` artifact suffix indicate lineage, not proof that rc.2 runtime bytes were executed. Older artifacts lacking the hardened qualification evidence are not retroactively upgraded.

## Scope / Non-Claims

This qualification covers graceful restart, bounded sandbox `fs.write`, matching capability revocation, persisted SQLite governance state, and the tested Gateway/Kingpin path.

It does **not** qualify SIGKILL/crash recovery, model replacement, arbitrary tools or effects, lease-token revocation variants, all identity changes, all restart/recovery combinations, generalized revocation correctness, cryptographic execution attestation, or standalone npm-package behavior beyond the stated component-equivalence finding. It is not a production-readiness certification.

## Production Impact

No Kingpin production code was changed for this case, and no Kingpin production defect was exposed. Hardening changes were confined to Harness scenario, evidence, and qualification machinery.
