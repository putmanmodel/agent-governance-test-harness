import type { RuntimeDeclaration } from '../../core/applicability.ts';

export const rc2GovernanceRuntime: RuntimeDeclaration = {
  id: 'kingpin-rc2-governance', capabilities: ['revocation'],
};
// Covers the implemented Gateway scenario drivers, not merely KingpinRc2Adapter.submit.
export const rc2GatewayRuntime: RuntimeDeclaration = {
  id: 'kingpin-rc2-gateway', capabilities: ['revocation', 'human-review', 'execution-accounting',
    'reconciliation', 'multi-principal', 'in-flight-observation', 'durable-restart'],
};
