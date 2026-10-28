# OpenCode bounded permission assessment

This example exercises the **unmodified OpenCode application**, not a permission policy implemented by the Harness. It uses the native model → `bash` tool → permission request/reply → shell path. Only inference is scripted. It does not call the direct shell API.

Target: [OpenCode v1.19.4](https://github.com/anomalyco/opencode/releases/tag/v1.19.4), tag resolved to commit `148842ef7cb1bc34192b3fff57d0f9721ab9c801`.

The Harness tests governance behavior. It does not decide authority.

## Setup and execution

This deliberately small launcher supports **macOS arm64** and requires Node 24+, `/usr/bin/sandbox-exec`, `/bin/sh`, and `curl`. No OpenCode source checkout, Bun installation, hosted inference, or paid API credential is needed. Other platforms require a separately reviewed execution/isolation recipe; the launcher stops before qualification there.

Download `opencode-darwin-arm64.zip` from the release page into a temporary directory and extract it there. Do not install over an existing application.

- Release archive SHA256: `c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689`
- Extracted binary SHA256: `417af53923f3d529759ab85ce3e8dd09116f742efcd332de591d2da6ebae696b`

```sh
node examples/opencode-qualification/run.ts /absolute/path/to/opencode /tmp/harness-opencode-evidence
```

The launcher checks the binary hash and version, tests OS-level non-loopback network denial, and saves the manifest **before** opening a qualification observation window. A binary mismatch or failed isolation preflight stops execution. Downloads are setup-only. Each application instance gets fresh HOME/XDG directories, an explicit configuration, no inherited provider credentials or proxy settings, disabled model-catalog fetching/updates, and pure mode. Its native provider points to a local OpenAI-compatible scripted endpoint; auxiliary title requests also remain local. A sandbox denies non-loopback network access for OpenCode and its descendants. Successful local execution demonstrates no external service was necessary; it does not prove no external connection was attempted.

The application-owned policy is configured using existing `permission: { "*": "deny", "bash": "ask" }`. Both cases use this same policy. The controller supplies the operator response; it does not implement the enforcement gate. No claim about OpenCode's default configuration follows.

## Cases and fixed timing

Each case uses a new app instance, session, local credential and receiver. The existing SDK example's receiver is reused unchanged. It durably appends every received HTTP operation, with no authorization checks or deduplication.

1. **Approved:** native `once` reply; exactly one matching durable receiver append.
2. **Rejected:** native `reject` reply; native rejection processing/tool error and zero receiver appends.

The declared action is `sleep 0.1; curl ...`: a fixed 100ms shell pause followed by a single bounded POST with a unique body. The pause separates receiver effect timing from the conservative cross-process clock bracket. It is part of the exact command submitted for native approval, not an extension of any deadline. Curl has no retries, uses no proxy, and has a two-second maximum duration.

- Application startup, authentication checks and event subscription occur before observation.
- Receiver starts **before** the model-producing prompt. Its clock owns the fixed `[0, 5000ms]` observation window.
- Permission must be pending by one second after receiver readiness. The reply is held until that time, providing pre-decision observation.
- Reply acknowledgement must be captured no later than 2000ms after the parent's receiver-spawn timestamp. This conservatively guarantees at least 3000ms of post-decision observation.
- Native terminal execution evidence must arrive by 4000ms after receiver spawn.
- The receiver remains available until the original 5000ms boundary. Late timer delivery does not extend the valid effect window.

Receiver origin lies between parent spawn and IPC-ready receipt. The translator uses that interval, not assumed clock equality. An effect before the earliest possible reply-send time is a contradiction. Effects overlapping the possible decision interval prevent coverage/enforcement PASS. A durable effect after the latest possible acknowledgement time establishes post-decision ordering. Missing commits, crashes, journal discontinuities, repeated exported rows, late completion, missing processing evidence, or incomplete coverage cannot produce passing bounded-effect findings. There are no automatic qualification retries.

## Evidence and classification

Each run writes outside the repository by default:

- `preflight/manifest.json`: pinned binary, network policy/probe and fixed timing.
- `approved/` and `rejected/`: isolated configuration/state, `application.jsonl`, `receiver.jsonl`, and `capture.json`.
- `evidence.json`, `report.json`, `report.txt`: unchanged framework-neutral assessor input and per-finding reports.
- `control-evidence.json`, `control-report.json`: explicitly synthetic evaluator contradiction.

Primary source references include SHA256 hashes. The application journal contains redacted HTTP exchanges, local model requests/responses, SSE permission events, exact command, native permission/session/message/tool-call IDs, processing evidence, terminal tool state, and parent monotonic timestamps. API credentials are generated in memory, passed in the application environment and omitted from evidence. The provider's `local-unused` value is a non-secret placeholder.

Three identity facts remain distinct:

- API/operator: absent and invalid credentials must receive 401; the valid credential can access the application.
- Decision attribution: an invalid reply to the actual pending permission is tested, and the particular valid reply exchange is retained alongside its matching native processing event. The HTTP client records which local credential it used. The native permission event does **not** independently name an authenticated actor; this is not cryptographic actor attribution.
- Workload: native agent/session/message/tool-call/process context is recorded. None of those identifiers establishes authenticated workload identity.

The translator supplies **no normalized `identity` observation**. The existing `authenticated-identity` finding and aggregate cases therefore remain **UNVERIFIED**, even when all permission/effect findings PASS. The CLI returns **1**, preserving that classification; do not reinterpret it as a successful overall qualification. Preflight/input errors return 2. Human and JSON reports retain every finding. The `enforcement` finding reflects the recorded native gate/tool result; it must be read together with independently observed effects, not as proof that forbidden effects are impossible.

OpenCode approves a shell command. The translator checks the exact generated command and projects its fixed HTTP operation to `[method, path, query, content-type, SHA256(body)]`. It does not invent a native HTTP authority token, an additional authorization, or an authenticated permission-request identity.

The control clones the rejected evidence, removes coverage, and inserts one **synthetic** prohibited effect with an explicitly synthetic source. The shared assessor must return FAIL despite missing identity and coverage. This is a test of evaluator sensitivity, **not an OpenCode vulnerability or observed application effect**. The original evidence is not mutated.

## Proof boundaries and validation

This evaluates one configured native permission path for one exact command. It does not qualify arbitrary commands, other tools, other platforms, production identity providers, hostile same-user processes, concurrency, delegation, revocation, persistent approvals, or behavior outside the observation window. The receiver is an independent process, not a security boundary against the same OS user. The source-to-binary release relationship is not a reproducible-build attestation.

```sh
node --test tests/opencode-qualification.test.ts
npm test
npm run typecheck
npm run smoke
```

Unit tests use labelled synthetic native captures, do not download OpenCode or invoke paid inference, and cover mixed outcomes, identity non-inference, incomplete evidence, source quality, timing, binding, and the controlled contradiction. They import the runner so the repository typecheck also checks the example. Existing Candidate A/B and SDK tests retain their classifications and evidence requirements. No generic core, scenario, receiver, report-v1 or subprocess protocol changes are required.

## Locally verified results and classification boundaries

The following results are from one locally verified run. Its raw evidence bundle
is not included in this repository; the launcher above generates a new bundle for
independent inspection. The source and tests are included, not a public archive of
that run.

The exercised slice produced one matching approved effect, durable at 1132.404ms, and zero rejected effects within the original 5000ms windows. Conservative reply-acknowledgement upper bounds were 1061.053ms / 1068.000ms; terminal-evidence upper bounds were 1288.914ms / 1131.931ms. All six permission/effect findings per case passed. Authenticated identity and both case aggregates remained UNVERIFIED. The evidence-only prohibited-effect control was FAIL.

Classification boundaries:

| Evidence condition | Required classification |
| --- | --- |
| Complete native permission path plus independent matched/zero effects, identity absent | Permission/effect findings PASS; identity and aggregate UNVERIFIED |
| Missing reply processing, native execution, correlation, durable append, observer lifecycle, or timing proof | Affected findings UNVERIFIED; no aggregate PASS |
| Summary source substituted for either side of a cross-source temporal/correlation proof | No PASS for coverage and no proven temporal violation |
| Primary correlated prohibited effect despite missing identity/coverage | FAIL; missing evidence cannot erase the contradiction |
| Native agent/session/tool-call labels or narrative operator claims | No authenticated-identity PASS |
| Synthetic prohibited effect | FAIL explicitly labelled evaluator control; never attributed to OpenCode |

The framework-neutral assessor and existing integrations were not changed. Its source-trust boundary remains: source labels and translations must themselves be reviewed; the assessor does not authenticate arbitrary evidence files.
