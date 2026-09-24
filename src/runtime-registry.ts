import type { RuntimeDeclaration } from './core/applicability.ts';
import type { ScenarioRegistration } from './core/applicability.ts';
import { rc2GatewayRuntime, rc2GovernanceRuntime } from './adapters/kingpin-rc2/capabilities.ts';
import { subprocessReferenceRuntime } from './adapters/subprocess/capabilities.ts';
import { gatewayRetryRegistration } from '../scenarios/registrations.ts';

export interface RuntimeProfile {
  runtime: RuntimeDeclaration;
  requirements?: Readonly<Record<string, ScenarioRegistration>>;
  drivers: Readonly<Record<string, () => Promise<{ passed: boolean }>>>;
}

export const runtimeProfiles: Readonly<Record<string, RuntimeProfile>> = {
  'subprocess-reference': {
    runtime: subprocessReferenceRuntime,
    drivers: { 'retry-after-revocation': async () => {
      const { SubprocessAdapter } = await import('./adapters/subprocess/adapter.ts');
      const { retryAfterRevocation } = await import('../scenarios/retry-after-revocation.ts');
      const { runScenario } = await import('./core/runner.ts');
      const { fileURLToPath } = await import('node:url');
      const adapter = new SubprocessAdapter(process.execPath, [fileURLToPath(new URL('../reference-runtime/runtime.mjs', import.meta.url))]);
      try { return await runScenario(retryAfterRevocation, adapter); }
      finally { await adapter.close(); }
    } },
  },
  'kingpin-rc2-governance': {
    runtime: rc2GovernanceRuntime,
    drivers: { 'retry-after-revocation': async () => {
      const { loadRc2Adapter } = await import('./adapters/kingpin-rc2/load.ts');
      const { retryAfterRevocation } = await import('../scenarios/retry-after-revocation.ts');
      const { runScenario } = await import('./core/runner.ts');
      const proposal = retryAfterRevocation.events.find(e => e.type === 'PROPOSE');
      if (!proposal || !('requestId' in proposal)) throw new Error('Missing proposal');
      return runScenario(retryAfterRevocation, await loadRc2Adapter(proposal.payload.request));
    } },
  },
  'kingpin-rc2-gateway': {
    runtime: rc2GatewayRuntime,
    requirements: { 'retry-after-revocation': gatewayRetryRegistration },
    drivers: {
      'retry-after-revocation': async () => (await import('./adapters/kingpin-rc2/gateway-scenario.ts')).runGatewayScenario(),
      'human-approval-replay': async () => (await import('./adapters/kingpin-rc2/review.ts')).runHumanApprovalReplay(),
      'delegated-handoff': async () => (await import('./adapters/kingpin-rc2/handoff.ts')).runDelegatedHandoff(),
      'staged-write-after-revocation': async () => (await import('./adapters/kingpin-rc2/staged.ts')).runStagedWrite(),
      'in-flight-revocation': async () => (await import('./adapters/kingpin-rc2/in-flight.ts')).runInFlightRevocation(),
    },
  },
};

export function getRuntimeProfile(id: string): RuntimeProfile {
  if (!Object.hasOwn(runtimeProfiles, id)) throw new Error(`Unknown runtime: ${id}`);
  return runtimeProfiles[id];
}
