import { createSubprocessProfile, parseCapabilities, capabilityDescriptions } from './adapters/subprocess/profile.ts';
import { parseArgs } from 'node:util';
import { getRuntimeProfile, runtimeProfiles } from './runtime-registry.ts';
import { getSuite, runSuite, formatSuiteReport, suiteExitCode } from './suite-runner.ts';

const help = `Agent Governance Test Harness
Usage:
  harness run --runtime <profile> --suite current [--json] [--artifact-dir <directory>]
  harness runtimes
  harness capabilities
  harness --help | -h

External runtime (no source registration):
  harness run --runtime subprocess --suite current --command python3 --command-arg ./my-runtime.py --capability revocation [--runtime-id my-runtime]

Options:
  --runtime       Built-in profile or external subprocess (see runtimes).
  --suite         Suite to run: current.
  --json          Emit one suite JSON report (reportVersion: "1").
  --artifact-dir  Save available timelines in a new run directory; report absolute paths.
  --command       External executable; no shell interpretation.
  --command-arg   Repeat for each argument; use --command-arg=-u for leading dashes.
  --capability    Repeat for each supported capability (see capabilities).
  --runtime-id    External report identity; defaults to external-subprocess.

PASS: assertions passed. FAIL: assertion, setup, protocol or harness failure.
UNSUPPORTED: missing prerequisites; not executed and not passed coverage.
Exit 0: no FAIL, including unsupported-only suites; help/discovery also exit 0.
Exit 1: any FAIL or invalid usage/runtime/suite. Check JSON coverage in CI.
Subprocess governance uses simulated enforcement/effects; flags do not supply drivers.`;

export async function runCli(args: string[], out: (text: string) => void, err: (text: string) => void): Promise<number> {
  try {
    const { values, positionals, tokens } = parseArgs({ args, strict: true, allowPositionals: true, tokens: true,
      options: { help: { type: 'boolean', short: 'h' }, 'artifact-dir': { type: 'string' }, runtime: { type: 'string' }, suite: { type: 'string' }, json: { type: 'boolean' },
        command: { type: 'string' }, 'command-arg': { type: 'string', multiple: true },
        capability: { type: 'string', multiple: true }, 'runtime-id': { type: 'string' } } });
    if (values.help) { out(help); return 0; }
    if (positionals.length === 1 && ['runtimes', 'capabilities'].includes(positionals[0])) {
      if (tokens.some(t => t.kind === 'option')) throw new Error('Discovery commands do not accept run options');
      out(positionals[0] === 'runtimes'
        ? [...Object.keys(runtimeProfiles), 'subprocess (external: --command <executable> --command-arg <argument>)'].join('\n')
        : Object.entries(capabilityDescriptions).map(([name, description]) => `${name}: ${description}`).join('\n'));
      return 0;
    }
    if (positionals.length !== 1 || positionals[0] !== 'run' || !values.runtime || !values.suite) {
      throw new Error('Usage: harness run --runtime <profile> --suite current [--json] [--artifact-dir <directory>]; see --help');
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
    if (values['artifact-dir'] !== undefined && !values['artifact-dir'].trim()) throw new Error('--artifact-dir must be nonempty');
    const profile = values.runtime === 'subprocess'
      ? createSubprocessProfile(values.command!, values['command-arg'] ?? [], parseCapabilities(values.capability ?? []), values['runtime-id'])
      : getRuntimeProfile(values.runtime);
    const suite = getSuite(values.suite);
    const report = await runSuite(profile, suite, { artifactDir: values['artifact-dir'] });
    out(values.json ? JSON.stringify(report) : formatSuiteReport(report));
    return suiteExitCode(report);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
