/**
 * [INPUT]: Depends on the canonical unified manifest contract, shared sensitive-path policy and durable byte publication.
 * [OUTPUT]: Provides writePluginDeclaration with exact canonical digest CAS, cancellation and source identity guards.
 * [POS]: Main-owned protected declaration writer; caller binds the current Chat/incarnation/source Project before this filesystem boundary.
 */
import { randomUUID } from "node:crypto";
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, renameSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, hashCanonical } from "@bottega/contracts/core/canonical-json";
import { parseStrictJson } from "@bottega/contracts/core/canonical";
import { pluginDigestSchema, unifiedPluginManifestSchema, type UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import { durableReplaceBytes, syncDirectory } from "../../persistence/durable-json";
import { assertPluginPath } from "../process/paths";
type Input = { sourceRoot: string; manifest: UnifiedPluginManifest; expectedManifestDigest: string; signal: AbortSignal; current(): void };
const pending = new Map<string, Promise<unknown>>();
const hash = (value: unknown) => "sha256:" + hashCanonical(value);
function readDeclaration(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1_048_576) throw new Error("Plugin declaration must be a bounded regular unlinked file");
  const file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const held = fstatSync(file);
    if (held.ino !== info.ino || held.dev !== info.dev) throw new Error("Plugin declaration changed during admission");
    const buffer = Buffer.alloc(info.size + 1); let offset = 0;
    while (offset < buffer.length) { const size = readSync(file, buffer, offset, buffer.length - offset, null); if (!size) break; offset += size; }
    const bytes = buffer.subarray(0, offset);
    if (bytes.length !== info.size) throw new Error("Plugin declaration changed during admission");
    return { info, manifest: unifiedPluginManifestSchema.parse(parseStrictJson(bytes, { maxBytes: 1_048_576, maxDepth: 64, maxNodes: 100_000 })) };
  } finally { closeSync(file); }
}
export async function writePluginDeclaration(input: Input) {
  input.signal.throwIfAborted(); input.current();
  const root = await assertPluginPath(input.sourceRoot);
  if (root !== resolve(input.sourceRoot) || (await lstat(input.sourceRoot)).isSymbolicLink()) throw new Error("Plugin source must be the canonical directory without symbolic links");
  const path = join(root, "bottega.plugin.json"), previous = pending.get(path) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const guard = () => { input.signal.throwIfAborted(); input.current(); };
    guard();
    const manifest = unifiedPluginManifestSchema.parse(input.manifest), expected = pluginDigestSchema.parse(input.expectedManifestDigest);
    const source = lstatSync(root), before = readDeclaration(path);
    if (!source.isDirectory() || source.isSymbolicLink()) throw new Error("Plugin source directory is invalid");
    if (hash(before.manifest) !== expected) throw new Error("Plugin declaration digest is stale; validate the current declaration again");
    if (manifest.id !== before.manifest.id) throw new Error("Plugin declaration identity cannot change");
    if (hash(manifest.source) !== hash(before.manifest.source)) throw new Error("Plugin source provenance cannot change");
    if (manifest.essential !== before.manifest.essential) throw new Error("Plugin essential provenance cannot change");
    const temporary = join(dirname(root), `.manifest-${randomUUID()}.tmp`);
    try {
      await durableReplaceBytes(temporary, Buffer.from(canonicalJson(manifest) + "\n"), 0o600, guard);
      guard();
      const directory = lstatSync(root), current = readDeclaration(path), staged = readDeclaration(temporary);
      if (hash(staged.manifest) !== hash(manifest)) throw new Error("Staged plugin declaration changed before publication");
      if (realpathSync(root) !== root || directory.ino !== source.ino || directory.dev !== source.dev || current.info.ino !== before.info.ino || current.info.dev !== before.info.dev || hash(current.manifest) !== expected)
        throw new Error("Plugin declaration digest or source identity changed before publication");
      // The final authority/CAS check and rename share one event turn; another host edit cannot interleave.
      guard(); renameSync(temporary, path); await syncDirectory(root);
      return { manifest, manifestDigest: hash(manifest) };
    } finally { await rm(temporary, { force: true }); }
  });
  pending.set(path, task);
  void task.then(() => { if (pending.get(path) === task) pending.delete(path); }, () => { if (pending.get(path) === task) pending.delete(path); });
  return task;
}
