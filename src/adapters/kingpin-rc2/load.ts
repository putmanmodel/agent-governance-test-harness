import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GovernanceRequest } from '../../core/runtime-adapter.ts';
import type { CdeTurn, Rc2Boundary, ActionBinding } from './contracts.ts';
import { KingpinRc2Adapter } from './adapter.ts';

export const rc2Root = resolve(process.env.RC2_ROOT ?? fileURLToPath(new URL('../../../../agent-tool-governance-gateway/', import.meta.url)));
export const retryBinding: ActionBinding = {
  action: 'action-x', target: 'target-x', tool: 'fs.delete', args: { path: '/project' },
  channelId: 'channel', sceneId: 'scene',
};

export async function loadRc2Adapter(original: GovernanceRequest): Promise<KingpinRc2Adapter> {
  const module = await import(pathToFileURL(resolve(rc2Root, 'kingpin/index.js')).href) as {
    KingpinAuthority: new (options: { clock: () => number }) => Rc2Boundary;
  };
  const python = process.env.CDE_PYTHON ?? (existsSync(resolve(rc2Root, '.venv-task/bin/python'))
    ? resolve(rc2Root, '.venv-task/bin/python') : 'python3');
  // The source repository's bridge batches three turns through one real CDE engine.
  // Input texts do not depend on runtime decisions in this one fixed scenario.
  const packets = Array.from({ length: 3 }, (_, i) => ({
    text: 'Please list the project files.', speaker_id: original.agent,
    channel_id: retryBinding.channelId, scene_id: retryBinding.sceneId,
    turn_id: `retry-revocation-${i}`, ts: i,
  }));
  const result = spawnSync(python, [resolve(rc2Root, 'conformance/cde_bridge.py')], {
    cwd: rc2Root, input: JSON.stringify(packets), encoding: 'utf8', timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error || result.status !== 0) throw new Error(`Real CDE invocation failed: ${result.error?.message ?? result.stderr}`);
  const turns: CdeTurn[] = JSON.parse(result.stdout);
  if (!Array.isArray(turns) || turns.length !== 3 || turns.some(t => !t.governance_signal || !t.top_event?.event_id)) {
    throw new Error('Unexpected real CDE bridge response');
  }
  return new KingpinRc2Adapter(new module.KingpinAuthority({ clock: () => 1_700_000_000_000 }), turns, retryBinding, original);
}
