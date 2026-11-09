// Release expectations are reviewed independently of suite registrations.
const portable = {
  suiteId: 'current',
  requiredPass: ['retry-after-revocation'],
  expectedIds: [
    'retry-after-revocation',
    'human-approval-replay',
    'delegated-handoff',
    'in-flight-revocation',
    'staged-write-after-revocation',
    'capability-revocation-survives-restart',
    'human-approval-consumption-survives-restart',
    'unknown-execution-survives-restart',
    'approved-review-revocation-survives-restart',
    'approved-review-foreign-principal-ingress-refusal',
  ],
} as const;

export const referenceProfile = { ...portable, runtimeId: 'subprocess-reference' };
export const pythonProfile = { ...portable, runtimeId: 'python-example' };
