import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inFlightInvariant } from '../src/adapters/kingpin-rc2/in-flight-assertion.ts';
import type { FlightEvidence } from '../src/adapters/kingpin-rc2/in-flight-assertion.ts';
import type { TimelineRecord } from '../src/core/timeline.ts';

// Checked-in native observation fixture. Unit mutations never invoke or change RC2.
function recorded(): TimelineRecord[] {
  return readFileSync(new URL('../artifacts/in-flight-revocation.rc2-gateway.jsonl', import.meta.url), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line));
}
function evidence(timeline: TimelineRecord[]): FlightEvidence {
  const r = timeline.find(r => r.category === 'governance' && r.data.requestId === 'in-flight-later');
  assert.ok(r?.category === 'governance');
  return r.data.evidence.rc2_in_flight as FlightEvidence;
}

test('recorded native experiment proves in-flight timing without inferring cancellation', () => {
  assert.equal(inFlightInvariant(recorded()).passed, true);
});

for (const mutation of ['false-cancellation', 'start-after-revocation', 'attempt-before-start', 'stale-authority', 'second-execution', 'missing-disposition']) {
  test(`in-flight invariant rejects ${mutation}`, () => {
    const timeline = recorded(), e = evidence(timeline);
    if (mutation === 'false-cancellation') { e.cancellation_claimed = true; e.reportedDisposition = 'cancelled'; }
    if (mutation === 'start-after-revocation') {
      e.started.events.find(r => r.record.event_type === 'tool.execution.started')!.sequence =
        e.afterFirst.events.find(r => r.record.event_type === 'capability.revoked')!.sequence + 1;
    }
    if (mutation === 'attempt-before-start') {
      const start = e.trace.find(r => r.event === 'start-observed')!;
      const attempt = e.trace.find(r => r.event === 'revocation-attempt')!;
      [start.event, attempt.event] = [attempt.event, start.event];
    }
    if (mutation === 'stale-authority') {
      const first = e.first.audit.find(r => r.event_type === 'authority.decision')!;
      const later = e.later!.audit.find((r: Record<string, unknown>) => r.event_type === 'authority.decision')!;
      later.evaluation_id = first.evaluation_id;
      later.decision_id = first.decision_id;
    }
    if (mutation === 'second-execution') e.later!.after.ledger.push({ execution_id: 'unauthorized-second' });
    if (mutation === 'missing-disposition') e.first.receipt.status = 'started';
    assert.equal(inFlightInvariant(timeline).passed, false);
  });
}

for (const disposition of ['failed', 'unknown']) {
  test(`in-flight assertion accepts an honestly reported ${disposition} disposition`, () => {
    // Scripted alternate execution-layer observations; do not claim these occurred in the live run.
    const rewrite = (value: any): any => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
        (key === 'status' || key === 'reportedDisposition') && item === 'succeeded' ? disposition
          : key === 'status' && item === 'SUCCEEDED' ? disposition.toUpperCase()
          : key === 'event_type' && item === 'tool.execution.succeeded' ? `tool.execution.${disposition}`
          : rewrite(item)]));
    };
    const timeline = rewrite(recorded()) as TimelineRecord[];
    assert.equal(inFlightInvariant(timeline).passed, true);
  });
}
