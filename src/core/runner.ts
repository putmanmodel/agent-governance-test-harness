import type { RuntimeAdapter } from './runtime-adapter.ts';
import type { Scenario } from './scenario.ts';
import { Timeline } from './timeline.ts';
import { SimulatedExecutor } from '../execution/simulated-executor.ts';

export async function runScenario(scenario: Scenario, runtime: RuntimeAdapter) {
  const events = [...scenario.events].sort((a, b) => a.order - b.order);
  if (events.length === 0 || events.some((event, i) =>
    !Number.isSafeInteger(event.order) || !Number.isFinite(event.timestamp)
    || (i > 0 && (event.order === events[i - 1].order || event.timestamp < events[i - 1].timestamp)))) {
    throw new Error('Scenario requires unique integer orders and nondecreasing finite logical timestamps.');
  }
  const timeline = new Timeline();
  const executor = new SimulatedExecutor();
  for (const event of events) {
    timeline.append(scenario.id, event, { category: 'scenario', data: event });
    if (!('requestId' in event)) {
      await runtime.inject({ type: event.type, ...event.payload });
      continue;
    }
    const request = structuredClone(event.payload.request);
    if (request.requestId !== event.requestId) throw new Error('Scenario request reference mismatch.');
    const decision = await runtime.submit(request);
    if (decision.requestId !== request.requestId) throw new Error('Runtime decision request reference mismatch.');
    timeline.append(scenario.id, event, { category: 'governance', data: decision });
    // Simulated Gateway: enforce the returned result without evaluating authority.
    const dispatch = decision.result === 'ALLOW';
    timeline.append(scenario.id, event, { category: 'enforcement', data: {
      requestId: request.requestId, decisionId: decision.decisionId, result: dispatch ? 'DISPATCH' : 'BLOCK',
    } });
    const results = dispatch ? executor.execute(request.requestId, event.payload.executionOutcome)
      : [{ requestId: request.requestId, status: 'NOT_STARTED' as const, reason: 'Simulated Gateway blocked dispatch.' }];
    for (const result of results) timeline.append(scenario.id, event, { category: 'execution', data: result });
  }
  const assertions = scenario.invariants.map(invariant => invariant(timeline.snapshot()));
  for (const assertion of assertions) timeline.append(scenario.id, events.at(-1)!, { category: 'assertion', data: assertion });
  return { timeline: timeline.snapshot(), assertions, passed: assertions.every(result => result.passed) };
}
