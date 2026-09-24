import type { TimelineRecord } from './timeline.ts';

export interface AssertionResult {
  invariantId: string;
  name: string;
  passed: boolean;
  reason: string;
  evidence: number[];
}

export type Invariant = (timeline: readonly TimelineRecord[]) => AssertionResult;
