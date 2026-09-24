import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function crashSnapshot(root: string) {
  const database = join(root, 'state.sqlite'), target = join(root, 'sandbox/effect.txt');
  const db = new DatabaseSync(database, { readOnly: true });
  const identity = (path: string) => { const s = statSync(path); return { dev: s.dev, ino: s.ino }; };
  const s = existsSync(target) ? statSync(target, { bigint: true }) : null;
  try { return {
    database: identity(database), sandbox: identity(join(root, 'sandbox')),
    metadata: db.prepare('SELECT * FROM store_metadata').all(),
    events: db.prepare('SELECT sequence, record FROM governance_events ORDER BY sequence').all()
      .map(r => ({ ...JSON.parse(String(r.record)), sequence: Number(r.sequence) })),
    ledger: db.prepare('SELECT record FROM executions ORDER BY rowid').all().map(r => JSON.parse(String(r.record))),
    file: s ? { source: 'harness', exists: true, content: readFileSync(target, 'utf8'), inode: String(s.ino),
      size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) } : { source: 'harness', exists: false },
    calls: existsSync(join(root, 'calls.jsonl')) ? readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(x => JSON.parse(x)) : [],
  }; } finally { db.close(); }
}
