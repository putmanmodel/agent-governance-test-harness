import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TimelineRecord } from '../core/timeline.ts';

export function toJsonl(timeline: readonly TimelineRecord[]): string {
  return timeline.map(record => JSON.stringify(record)).join('\n') + '\n';
}

export async function writeJsonl(path: string, timeline: readonly TimelineRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJsonl(timeline), 'utf8');
}
