import type { ScenarioEvent, ExecutionResult } from './events.ts';
import type { RuntimeDecision } from './runtime-adapter.ts';
import type { AssertionResult } from './assertions.ts';

export const HARNESS_SCHEMA_VERSION = '1' as const;

type TimelineEntry =
  | { category: 'scenario'; data: ScenarioEvent }
  | { category: 'governance'; data: RuntimeDecision }
  | { category: 'enforcement'; data: { requestId: string; decisionId: string; result: 'DISPATCH' | 'BLOCK' } }
  | { category: 'execution'; data: ExecutionResult }
  | { category: 'assertion'; data: AssertionResult };

export type TimelineRecord = TimelineEntry & {
  harness_schema_version: typeof HARNESS_SCHEMA_VERSION;
  sequence: number;
  scenarioId: string;
  timestamp: number;
  eventOrder: number;
};

export class Timeline {
  #records: TimelineRecord[] = [];

  append(scenarioId: string, event: Pick<ScenarioEvent, 'timestamp' | 'order'>, entry: TimelineEntry): void {
    this.#records.push(structuredClone({
      ...entry, harness_schema_version: HARNESS_SCHEMA_VERSION, scenarioId, timestamp: event.timestamp,
      eventOrder: event.order, sequence: this.#records.length + 1,
    }));
  }

  snapshot(): TimelineRecord[] { return structuredClone(this.#records); }
}
