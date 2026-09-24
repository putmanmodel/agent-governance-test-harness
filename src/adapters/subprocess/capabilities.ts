import type { RuntimeDeclaration } from '../../core/applicability.ts';

// Declaration for this configured reference process, not every possible JSONL process.
export const subprocessReferenceRuntime: RuntimeDeclaration = {
  id: 'subprocess-reference', capabilities: ['revocation'],
};
