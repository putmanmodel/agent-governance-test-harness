import { runCli } from './harness-cli.ts';
process.exitCode = await runCli(process.argv.slice(2), console.log, console.error);
