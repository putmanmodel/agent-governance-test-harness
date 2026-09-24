import type { ScenarioEvent } from './events.ts';
import type { Invariant } from './assertions.ts';

export interface Scenario {
  id: string;
  events: readonly ScenarioEvent[];
  invariants: readonly Invariant[];
}
