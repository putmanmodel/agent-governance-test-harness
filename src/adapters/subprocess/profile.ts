import type { RuntimeCapability } from '../../core/applicability.ts';
import type { RuntimeProfile } from '../../runtime-registry.ts';
import { SubprocessAdapter } from './adapter.ts';
import { runScenario } from '../../core/runner.ts';
import { retryAfterRevocation } from '../../../scenarios/retry-after-revocation.ts';

// Exhaustive against the core union without changing the generic contract.
export const capabilityDescriptions: Record<RuntimeCapability, string> = {
  'durable-restart': 'Replace a process and reopen preserved state for a supported driver.',
  revocation: 'Apply and acknowledge authority revocation.',
  'human-review': 'Observe approval, consumption and replay.',
  'execution-accounting': 'Observe native execution records.',
  reconciliation: 'Resolve execution uncertainty from evidence.',
  'multi-principal': 'Exercise separately authenticated identities.',
  'in-flight-observation': 'Observe execution and control ordering while outstanding.',
};
export function parseCapabilities(names: readonly string[]): RuntimeCapability[] {
  for (const name of names) {
    if (!Object.hasOwn(capabilityDescriptions, name)) throw new Error(`Unknown capability: ${name}`);
  }
  return [...new Set(names)] as RuntimeCapability[];
}

export function createSubprocessProfile(command: string, args: string[], capabilities: RuntimeCapability[], id = 'external-subprocess'): RuntimeProfile {
  return {
    runtime: { id, capabilities },
    drivers: { 'retry-after-revocation': async () => {
      const adapter = new SubprocessAdapter(command, args);
      try { return await runScenario(retryAfterRevocation, adapter); }
      finally { await adapter.close(); }
    } },
  };
}
