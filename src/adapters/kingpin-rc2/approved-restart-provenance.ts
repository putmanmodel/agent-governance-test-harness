import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { rc2Root } from './load.ts';
export const scenarioId = 'approved-review-revocation-survives-restart';
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const harnessRoot = fileURLToPath(new URL('../../../', import.meta.url));
function repository(root: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const changedFiles = git('status', '--porcelain=v1', '--untracked-files=all').split('\n').filter(Boolean);
  return { commit: git('rev-parse', 'HEAD'), dirty: changedFiles.length > 0, changedFiles };
}
function inventory(root: string, directories: string[]) {
  const files: Record<string, string> = {};
  const walk = (path: string) => {
    for (const e of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['__pycache__', '.git'].includes(e.name)) continue;
      const full = join(path, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && /\.(js|mjs|cjs|ts|json|sql|py)$/.test(e.name)) files[relative(root, full)] = sha256(readFileSync(full));
    }
  };
  for (const directory of directories) if (existsSync(join(root, directory))) walk(join(root, directory));
  return files;
}
export function runtimeProvenance() {
  const root = realpathSync(rc2Root), db = new DatabaseSync(':memory:');
  const sqlite = db.prepare('SELECT sqlite_version() AS version').get()!.version; db.close();
  const python = process.env.CDE_PYTHON ?? (existsSync(join(root, '.venv-task/bin/python')) ? join(root, '.venv-task/bin/python') : 'python3');
  return { source: 'repository-source', root, repository: repository(root), node: process.version,
    platform: process.platform, architecture: process.arch, sqlite, nodeExecutable: realpathSync(process.execPath),
    nodeExecutableSha256: sha256(readFileSync(process.execPath)),
    python: JSON.parse(execFileSync(python, ['-c',
      'import sys,os,json,hashlib,importlib.metadata as m; p=os.path.realpath(sys.executable); print(json.dumps(dict(executable=p,version=sys.version,sha256=hashlib.sha256(open(p,"rb").read()).hexdigest(),distributions=sorted([(d.metadata["Name"],d.version) for d in m.distributions()]))))'], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })),
    // Superset of loaded source and JS dependencies, not a claim that every file executed.
    inventoryScope: 'kingpin, gateway_node (including installed dependencies), execution, evaluation, src, conformance, manifests; source/resource files',
    files: inventory(root, ['kingpin', 'gateway_node', 'execution', 'evaluation', 'src', 'conformance', 'manifests']) };
}
export function harnessProvenance() {
  return { root: realpathSync(harnessRoot), repository: repository(harnessRoot),
    files: inventory(harnessRoot, ['src', 'scenarios', 'tests']),
    packageHash: sha256(readFileSync(join(harnessRoot, 'package.json'))),
    lockHash: sha256(readFileSync(join(harnessRoot, 'package-lock.json'))) };
}
export function sdkEquivalence(runtime: ReturnType<typeof runtimeProvenance>) {
  const archive = join(runtime.root, 'qualification/sdk-rc-0.1.0-rc.3/evidence/kingpin-runtime-0.1.0-rc.3.tgz');
  const expectedArchiveSha256 = '7207254ae3621aeba68e437b51e602a359c6a2fd8a06038fd07a94a787e2f4a8';
  if (!existsSync(archive)) return { established: false, reason: 'Retained rc.3 archive unavailable' };
  const archiveSha256 = sha256(readFileSync(archive));
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
    .filter(p => /\.(js|sql)$/.test(p) || p === 'package/policy/default/policy.json');
  const files = Object.fromEntries(names.map(name => {
    const path = name.replace(/^package\//, '');
    return [path, { archiveSha256: sha256(execFileSync('tar', ['-xOf', archive, name])), sourceSha256: runtime.files[`kingpin/${path}`] }];
  }));
  return { established: archiveSha256 === expectedArchiveSha256 && names.length === 17
      && Object.values(files).every(f => f.archiveSha256 === f.sourceSha256),
    package: 'kingpin-runtime', version: '0.1.0-rc.3', archive, archiveSha256, expectedArchiveSha256,
    reference: 'Retained published archive digest verified during adversarial closeout; no live registry query in the scenario',
    scope: 'SDK runtime JS, SQL and default policy only; excludes Gateway, CDE and execution adapter qualification', files };
}
