import { parseArgs } from 'node:util';
import { getRuntimeProfile } from './runtime-registry.ts';
import { getSuite, runSuite, formatSuiteReport, suiteExitCode } from './suite-runner.ts';

export async function runCli(args: string[], out: (text: string) => void, err: (text: string) => void): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, strict: true, allowPositionals: true,
      options: { runtime: { type: 'string' }, suite: { type: 'string' }, json: { type: 'boolean' } } });
    if (positionals.length !== 1 || positionals[0] !== 'run' || !values.runtime || !values.suite) {
      throw new Error('Usage: harness run --runtime <profile> --suite current [--json]');
    }
    const profile = getRuntimeProfile(values.runtime);
    const suite = getSuite(values.suite);
    const report = await runSuite(profile, suite);
    out(values.json ? JSON.stringify(report) : formatSuiteReport(report));
    return suiteExitCode(report);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
