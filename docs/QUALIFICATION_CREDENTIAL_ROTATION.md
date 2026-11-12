# H3 — Credential Rotation and Review Replay Isolation

| Case | Memory | SQLite | When the original approval was consumed |
|---|---|---|---|
| CR-01 | PASS | PASS | B executed the pending approved operation after replacement. |
| CR-02 | PASS | PASS | A executed before replacement. B presented the consumed approval and received a conflict. |

The Harness issued an operation, captured its original review UUID and binding, and obtained reviewer approval. At cutover, the old credential failed authentication and the replacement authenticated as the same principal and agent. Each replay used the original review and operation. Each case accounted for exactly one adapter entry, one succeeded execution receipt tied to the original request, and the corresponding lifecycle records and bounded sandbox effect.

Memory uses an explicit fixture cutover. SQLite uses two distinct OS processes. The parent observed clean exit before replacement, read durable state across the gap and checked the database, sandbox and independent invocation journal after B exited.

Offline mutations challenge identity substitution, a different review, stale observations, duplicate adapter entry, missing receipt or lifecycle, and unreadable observers. SQLite mutations also challenge PID, ordering, continuity and durable state. The results cover these bounded operations during controlled cutover and graceful restart. Credential hot reload, crashes, arbitrary exactly-once effects and other platforms fall outside the qualification.

[Evidence manifest](../evidence/h3-h4-disclosure.json) · [Reproduction and offline checks](H3_H4_REPRODUCTION.md)
