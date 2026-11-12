# H4 — Authority Contraction Across Rotation

| SQLite case | Result | Observed enforcement boundary |
|---|---|---|
| CR-03 | UNSUPPORTED | RC.4 lacks a per-agent runtime permission override that preserves agent identity. Execution was skipped. |
| CR-04 | PASS | B authenticated. Runtime scope refused the operation before consumption. The original review remained approved. |
| CR-05 | PASS | Capability revocation survived restart. Governance revalidation invalidated the original approval. |
| CR-06 | PASS | A contracted authority envelope survived restart. Governance revalidation invalidated the original approval. |

The parent observed A exit cleanly and B start against the original SQLite database and sandbox. Review UUID, operation binding, authority state and ordered requests link the observations across the gap. All three refusals had zero durable adapter invocations and zero execution receipts. The bounded target and lifecycle observations corroborated those reads.

Omitting each protection in a live control allowed execution and caused its case verifier to fail. Eighteen offline mutations challenged evidence used to classify the three refusals. CR-06 supplied a controlled trusted gate-2 detector signal. The qualification covers the resulting Kingpin authority decision and Gateway enforcement. Independent Python generation of that signal remains untested. The restart was graceful and filesystem observations cover the bounded operation.

[Evidence manifest](../evidence/h3-h4-disclosure.json) · [Reproduction and offline checks](H3_H4_REPRODUCTION.md)
