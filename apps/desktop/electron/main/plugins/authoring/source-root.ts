/**
 * [INPUT]: Installation userData identity, filesystem canonicalization and the Project workspace guard.
 * [OUTPUT]: pluginSourceRoot creates an installation-specific editable source tree outside host-owned data and rejects linked source directories.
 * [POS]: Shared source allocation for new plugins and the official Sketch seed; Project admission remains authoritative.
 */
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { assertWorkspaceDisjoint } from '../../projects/fs-utils';

export async function pluginSourceRoot(userData: string, id: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) throw new Error('Invalid plugin source identity');
  await mkdir(userData, { recursive: true });
  const profile = await realpath(userData);
  const sources = `${profile}-plugin-sources`;
  await mkdir(sources, { recursive: true, mode: 0o700 });
  const canonicalSources = await realpath(sources);
  assertWorkspaceDisjoint(canonicalSources, [profile]);
  const root = join(canonicalSources, id);
  for (const directory of [root, join(root, 'gui'), join(root, 'gui', 'src')]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error('Plugin source directory must not be a symlink');
  }
  return root;
}
