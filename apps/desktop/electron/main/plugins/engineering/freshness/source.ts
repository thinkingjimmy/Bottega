/**
 * [INPUT]: Canonical source binding, accepted source receipt, filesystem identity and bounded source inventory.
 * [OUTPUT]: inspectPluginSource verifies the exact real directory and compares current source bytes before any dependency work.
 * [POS]: Operation-loaded source freshness check; runtime-only code selection never changes its baseline.
 */
import { lstat, realpath } from "node:fs/promises";
import type { PluginSourceBuild } from "../../platform/model";
import { inventoryPluginTree, pluginHash } from "../snapshot";
export async function inspectPluginSource(directory: string, previous?: PluginSourceBuild | null, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const info = await lstat(directory), canonical = await realpath(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || canonical !== directory) throw new Error("PLUGIN_SOURCE_DIRECTORY_CHANGED: source binding must name the same canonical real directory");
  const sourceDigest = pluginHash(await inventoryPluginTree(canonical, { signal }));
  signal?.throwIfAborted();
  return { sourceDirectory: canonical, sourceDigest, unchanged: previous?.sourceDirectory === canonical && previous.sourceDigest === sourceDigest };
}
