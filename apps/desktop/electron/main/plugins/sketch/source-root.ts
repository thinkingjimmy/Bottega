/**
 * [INPUT]: Installation userData identity, filesystem canonicalization and private native execution-cache custody.
 * [OUTPUT]: nativeSketchSourceRoot creates the private native Sketch compilation source and rejects linked source directories.
 * [POS]: Native Sketch execution cache; user-editable source Projects belong only to Library unified plugins.
 */
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export async function nativeSketchSourceRoot(userData: string): Promise<string> {
  await mkdir(userData, { recursive: true });
  const profile = await realpath(userData);
  const sources = join(profile, 'native-feature-ui');
  await mkdir(sources, { recursive: true, mode: 0o700 });
  const canonicalSources = await realpath(sources);
  if (canonicalSources !== sources) throw new Error('Native Sketch source cache must not be a symbolic link');
  const root = join(canonicalSources, 'sketch', 'source');
  for (const directory of [root, join(root, 'gui'), join(root, 'gui', 'src')]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error('Plugin source directory must not be a symlink');
  }
  return root;
}
