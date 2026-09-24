import { createSubprocessProfile, parseCapabilities } from './adapters/subprocess/profile.ts';
import { parseArgs } from 'node:util';
import { getRuntimeProfile } from './runtime-registry.ts';
import { getSuite, runSuite, formatSuiteReport, suiteExitCode } from './suite-runner.ts';

export async function runCli(args: string[], out: (text: string) => void, err: (text: string) => void): Promise<number> {
  try {
    const { values, positionals, tokens } = parseArgs({ args, strict: true, allowPositionals: true, tokens: true,
      options: { runtime: { type: 'string' }, suite: { type: 'string' }, json: { type: 'boolean' },
        command: { type: 'string' }, 'command-arg': { type: 'string', multiple: true },
        capability: { type: 'string', multiple: true }, 'runtime-id': { type: 'string' } } });
    if (positionals.length !== 1 || positionals[0] !== 'run' || !values.runtime || !values.suite) {
      throw new Error('Usage: harness run --runtime <profile> --suite current [--json]');
    }
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== 'option' || ['command-arg', 'capability'].includes(token.name)) continue;
      if (seen.has(token.name)) throw new Error(`Repeated option: --${token.name}`);
      seen.add(token.name);
    }
    const externalFlags = ['command', 'command-arg', 'capability', 'runtime-id'] as const;
    if (values.runtime !== 'subprocess' && externalFlags.some(key => values[key] !== undefined)) {
      throw new Error('External command/capability/identity options require --runtime subprocess');
    }
    if (values.runtime === 'subprocess' && !values.command?.trim()) throw new Error('--runtime subprocess requires --command <executable>');
    if (values['runtime-id'] !== undefined && !values['runtime-id'].trim()) throw new Error('--runtime-id must be nonempty');
    const profile = values.runtime === 'subprocess'
      ? createSubprocessProfile(values.command!, values['command-arg'] ?? [], parseCapabilities(values.capability ?? []), values['runtime-id'])
      : getRuntimeProfile(values.runtime);
    const suite = getSuite(values.suite);
    const report = await runSuite(profile, suite);
    out(values.json ? JSON.stringify(report) : formatSuiteReport(report));
    return suiteExitCode(report);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
