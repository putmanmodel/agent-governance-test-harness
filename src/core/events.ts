import type { GovernanceRequest } from './runtime-adapter.ts';

interface EventBase {
  timestamp: number; // Scenario-defined logical time, never wall-clock time.
  order: number;
  principal?: string;
  agent?: string;
}

export type ExecutionStatus = 'NOT_STARTED' | 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export interface ExecutionResult {
  requestId: string;
  status: ExecutionStatus;
  reason: string;
}

export type ScenarioEvent = EventBase & (
  | { type: 'GRANT' | 'REVOKE'; payload: { authorityRef: string } }
  | { type: 'PROPOSE' | 'RETRY'; requestId: string; payload: {
      request: GovernanceRequest;
      executionOutcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
    } }
);
