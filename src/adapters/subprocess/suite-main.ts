import { runSubprocessSuite, formatSuite } from './suite.ts';
const results = await runSubprocessSuite();
console.log(formatSuite(results));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
