import type { RuntimeCapability } from '../../core/applicability.ts';
import type { RuntimeProfile } from '../../runtime-registry.ts';
import { SubprocessAdapter } from './adapter.ts';
import { runScenario } from '../../core/runner.ts';
import { retryAfterRevocation } from '../../../scenarios/retry-after-revocation.ts';

// Exhaustive against the core union without changing the generic contract.
const capabilities: Record<RuntimeCapability, true> = {
  revocation: true, 'human-review': true, 'execution-accounting': true,
  reconciliation: true, 'multi-principal': true, 'in-flight-observation': true,
};
export function parseCapabilities(names: readonly string[]): RuntimeCapability[] {
  for (const name of names) {
    if (!Object.hasOwn(capabilities, name)) throw new Error(`Unknown capability: ${name}`);
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
