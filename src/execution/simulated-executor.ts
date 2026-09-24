import type { ExecutionResult } from '../core/events.ts';

export class SimulatedExecutor {
  execute(requestId: string, outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'): ExecutionResult[] {
    return [
      { requestId, status: 'STARTED', reason: 'Simulated effect dispatched.' },
      { requestId, status: outcome, reason: 'Scenario-injected execution outcome.' },
    ];
  }
}
