import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { approvedSnapshot } from './approved-restart-snapshot.ts';

export function journal(root: string) {
  return readFileSync(join(root, 'observer.jsonl'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
}
export function appendObservation(root: string, record: Record<string, unknown>) {
  appendFileSync(join(root, 'observer.jsonl'), JSON.stringify(record) + '\n', { flush: true, mode: 0o600 });
}
export function durableSnapshot(root: string) {
  const snapshot = approvedSnapshot(root);
  const db = new DatabaseSync(join(root, 'state.sqlite'), { readOnly: true });
  try {
    return structuredClone({ ...snapshot, contexts: db.prepare('SELECT * FROM contexts ORDER BY context_key').all(),
      directory: readdirSync(join(root, 'sandbox')).sort() });
  } finally { db.close(); }
}
