import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crashSnapshot } from './unknown-restart-snapshot.ts';
// Reuse independent filesystem, accounting and durable adapter-call observations.
export function approvedSnapshot(root: string) {
  const snapshot = crashSnapshot(root);
  const observer = readFileSync(join(root, 'observer.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const db = new DatabaseSync(join(root, 'state.sqlite'), { readOnly: true });
  try { return { ...snapshot, observer, calls: observer.filter(r => r.type === 'execute'),
    reviews: db.prepare('SELECT record FROM reviews ORDER BY review_id').all().map(r => JSON.parse(String(r.record))),
    revocations: db.prepare('SELECT * FROM capability_revocations ORDER BY context_key, tool').all(),
  }; } finally { db.close(); }
}
