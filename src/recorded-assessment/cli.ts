import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadCandidateAB } from './sources/candidate-ab.ts';
import { createReport, exitCode, renderReport } from './report.ts';
import { ValidationError } from './evidence.ts';
export async function main(args: string[]): Promise<number> {
  try {
    const json = args.includes('--json');
    const rest = args.filter(a => a !== '--json');
    if (args.filter(a => a === '--json').length > 1 || rest.length !== 1 || rest[0].startsWith('--') && rest[0] !== '--candidate-ab') throw new ValidationError('Usage: npm run assess:recorded -- <evidence.json | --candidate-ab> [--json]');
    const input: unknown = rest[0] === '--candidate-ab' ? await loadCandidateAB() : JSON.parse(await readFile(rest[0], 'utf8'));
    const report = createReport(input);
    process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : renderReport(report));
    return exitCode(report);
  } catch (error) {
    process.stderr.write(`Assessment input error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2; // no fabricated governance failure/report for unusable inputs
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
