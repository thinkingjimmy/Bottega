/**
 * [INPUT]: Fixed archives, complete baseline/target sets, durable effect intents and current Chat/workspace authority.
 * [OUTPUT]: Bounded create/replace/delete plans and exact source publication with path CAS and restart-safe receipts.
 * [POS]: File effects of the existing document journal; recovery does not depend on a valid intermediate manifest or view generation.
 */
import { constants, openSync, closeSync, fstatSync, readSync, realpathSync, lstatSync, unlinkSync, type Stats } from "node:fs";
import { join, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { durableReplaceBytes, ensureDurableDirectory, syncDirectory } from "../../persistence/durable-json";
import { readDesignSet, readPreparedDesignSet } from "./read-set";
import { DESIGN_LIMITS, DESIGN_SLIDES_LIMITS, DESIGN_EFFECT_LIMITS, designFileLimit, DesignDocumentError, designDigest, sourcePath, type DesignReadSet } from "./model";
import type { DesignOperation, DesignSourceEffect, DesignSourceWrite } from "./store";
import { interruptionPoint } from "../../startup/boot/composition-hooks";

type DirectoryIdentity = { path: string; identity: string };
type FileState = { digest: string; stamp: string } | null;
const stamp = (value: Stats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
const conflict = (path: string, message: string): never => {
  throw new DesignDocumentError("SOURCE_CHANGED", message, [{ file: path, message }]);
};

export function transformedDesignSet(path: string, input: readonly { path: string; data: Uint8Array }[]): DesignReadSet {
  if (input.length > designFileLimit(input) || new Set(input.map(file => file.path)).size !== input.length)
    throw new DesignDocumentError("BUDGET_EXCEEDED", "Edit exceeds the document file budget");
  const files = input.map(file => {
    sourcePath.parse(file.path);
    if (["canvas.json", "deck.json", "dashboard.json"].includes(file.path) && file.data.length > DESIGN_LIMITS.manifest || /\.html$/i.test(file.path) && file.data.length > DESIGN_LIMITS.html)
      throw new DesignDocumentError("BUDGET_EXCEEDED", "Edited file exceeds its budget");
    return { path: file.path, data: Buffer.from(file.data), digest: designDigest(file.data), stamp: "prepared-edit" };
  }).sort((a, b) => a.path < b.path ? -1 : 1);
  const bytes = files.reduce((total, file) => total + file.data.length, 0);
  if (bytes > DESIGN_LIMITS.source) throw new DesignDocumentError("BUDGET_EXCEEDED", "Edit exceeds the source budget");
  return { path, files, bytes, readSetDigest: designDigest(JSON.stringify(files.map(file => [file.path, file.data.length, file.digest]))) };
}

export function designSourceEffects(baseline: readonly { path: string; digest: string }[], desired: DesignReadSet): DesignSourceEffect[] {
  if (baseline.length > DESIGN_SLIDES_LIMITS.files || new Set(baseline.map(file => file.path)).size !== baseline.length)
    throw new DesignDocumentError("INVALID_DOCUMENT", "Prepared baseline is not a bounded unique file set");
  const before = new Map(baseline.map(file => [sourcePath.parse(file.path), file.digest]));
  const after = new Map(desired.files.map(file => [file.path, file.digest]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  if (paths.length > DESIGN_EFFECT_LIMITS.files) throw new DesignDocumentError("BUDGET_EXCEEDED", "Source effect union exceeds its budget");
  for (let index = 0; index < paths.length; index++) {
    if (paths.slice(index + 1).some(path => path.startsWith(paths[index]! + "/")))
      throw new DesignDocumentError("PATH_DENIED", "A source batch cannot replace a file with a parent directory");
  }
  return paths.flatMap(path => {
    const prior = before.get(path) ?? null, next = after.get(path) ?? null;
    return prior === next ? [] : [{ path, kind: prior === null ? "create" as const : next === null ? "delete" as const : "replace" as const, before: prior, after: next }];
  });
}

function directoryIdentity(root: string, path: string): DirectoryIdentity {
  const absolute = join(root, path);
  try {
    const info = lstatSync(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(absolute) !== absolute)
      throw new DesignDocumentError("PATH_DENIED", "Source directory is no longer a real directory");
    return { path, identity: `${info.dev}:${info.ino}` };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") conflict(path, "A prepared source directory was removed");
    throw cause;
  }
}
function assertDirectories(root: string, directories: readonly DirectoryIdentity[]) {
  for (const directory of directories) if (directoryIdentity(root, directory.path).identity !== directory.identity)
    conflict(directory.path, "A prepared source directory was replaced");
}
function parentIdentities(root: string, path: string) {
  const result = [directoryIdentity(root, "")];
  const parts = path.split("/").slice(0, -1);
  for (let index = 1; index <= parts.length; index++) result.push(directoryIdentity(root, parts.slice(0, index).join("/")));
  return result;
}
function fileState(root: string, path: string): FileState {
  const absolute = join(root, path);
  let info: Stats;
  try { info = lstatSync(absolute); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
  if (!info.isFile() || info.isSymbolicLink() || info.size > DESIGN_LIMITS.source || realpathSync(absolute) !== absolute)
    throw new DesignDocumentError("PATH_DENIED", "Source effect target is not a bounded regular file");
  const handle = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (stamp(fstatSync(handle)) !== stamp(info)) conflict(path, "Source changed before opening the effect target");
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(handle, data, offset, data.length - offset, offset);
      if (!count) conflict(path, "Source was truncated while checking the effect target");
      offset += count;
    }
    const digest = designDigest(data);
    if (stamp(fstatSync(handle)) !== stamp(info) || stamp(lstatSync(absolute)) !== stamp(info))
      conflict(path, "Source changed while checking the effect target");
    return { digest, stamp: stamp(info) };
  } finally { closeSync(handle); }
}
function assertEffectState(effect: DesignSourceEffect, current: FileState, write: DesignSourceWrite | undefined, baselineStamp?: string) {
  const digest = current?.digest ?? null;
  if (!write) {
    if (digest !== effect.before || baselineStamp && current?.stamp !== baselineStamp)
      conflict(effect.path, "Source differs from the prepared baseline without a durable effect intent");
    return;
  }
  if (write.state === "applied") {
    if (digest !== effect.after || write.afterStamp !== undefined && (current?.stamp ?? null) !== write.afterStamp)
      conflict(effect.path, "An applied source effect was changed externally");
    return;
  }
  if (digest === effect.before) {
    const expectedStamp = write.beforeStamp ?? baselineStamp;
    if (expectedStamp && current?.stamp !== expectedStamp) conflict(effect.path, "The original effect target was replaced");
  } else if (digest !== effect.after) conflict(effect.path, "Source differs from both states of the prepared effect");
}

export async function applyPreparedDesignEdit(operation: DesignOperation, archive: Uint8Array, assertAuthority: () => void,
  recordWrite: (path: string, state: "started" | "applied", details?: Omit<DesignSourceWrite, "path" | "state">) => Promise<unknown>) {
  const edit = operation.sourceEdit; if (!edit || edit.applied) return;
  if (designDigest(archive) !== operation.revision.snapshotRef) throw new DesignDocumentError("INVALID_DOCUMENT", "Prepared archive identity changed");
  const authority = operation.revision.authority, root = join(await realpath(authority.workspace), operation.revision.path);
  if (!/^(?:design|design-systems)\/[a-z0-9][a-z0-9_-]{0,63}$/.test(operation.revision.path))
    throw new DesignDocumentError("PATH_DENIED", "Invalid prepared source directory");
  const desired = transformedDesignSet(operation.revision.path, unpackArtifactArchive(archive, 512));
  if (desired.readSetDigest !== operation.revision.readSetDigest) throw new DesignDocumentError("INVALID_DOCUMENT", "Prepared source digest changed");
  const effects = designSourceEffects(edit.baseline, desired);
  if (edit.effects && !edit.initial && !edit.directories?.some(directory => directory.path === ""))
    throw new DesignDocumentError("INVALID_DOCUMENT", "Prepared source plan has no root directory identity");
  if (edit.effects && JSON.stringify(edit.effects) !== JSON.stringify(effects)) throw new DesignDocumentError("INVALID_DOCUMENT", "Prepared file effect plan changed");
  const baseline = new Map(edit.baseline.map(file => [file.path, file]));
  const desiredMap = new Map(desired.files.map(file => [file.path, file]));
  const planned = new Map(effects.map(effect => [effect.path, effect]));
  const writes = new Map(edit.writes.map(write => [write.path, write]));
  if (writes.size !== edit.writes.length || edit.writes.some(write => !planned.has(write.path)))
    throw new DesignDocumentError("INVALID_DOCUMENT", "Source effect receipts do not match the prepared plan");
  assertAuthority();
  if (edit.initial) { await ensureDurableDirectory(root); assertAuthority(); }
  assertDirectories(root, edit.directories ?? []);
  for (const write of writes.values()) {
    if (edit.effects && (!write.parents?.length || write.parents[0]?.path !== "")) throw new DesignDocumentError("INVALID_DOCUMENT", "Source effect intent has no parent identities");
    assertDirectories(root, write.parents ?? []);
  }
  const current = await readPreparedDesignSet(authority.workspace, operation.revision.path);
  for (const file of current.files) if (!baseline.has(file.path) && !desiredMap.has(file.path)) conflict(file.path, "Unrelated source file appeared during the prepared edit");
  const currentMap = new Map(current.files.map(file => [file.path, file]));
  for (const path of new Set([...baseline.keys(), ...desiredMap.keys()])) {
    const file = currentMap.get(path), state = file ? { digest: file.digest, stamp: file.stamp } : null;
    const effect = planned.get(path);
    if (effect) assertEffectState(effect, state, writes.get(path), baseline.get(path)?.stamp);
    else if (state?.digest !== baseline.get(path)?.digest || baseline.get(path)?.stamp && state?.stamp !== baseline.get(path)?.stamp)
      conflict(path, "Unchanged source differs from the prepared baseline");
  }
  for (const effect of effects) {
    let write = writes.get(effect.path);
    const target = join(root, effect.path);
    if (!write) {
      interruptionPoint("document-source-edit", "before:" + effect.path);
      assertAuthority(); assertDirectories(root, edit.directories ?? []);
      await ensureDurableDirectory(dirname(target));
      const parents = parentIdentities(root, effect.path), state = fileState(root, effect.path);
      assertEffectState(effect, state, undefined, baseline.get(effect.path)?.stamp);
      write = { path: effect.path, state: "started", parents, beforeStamp: state?.stamp ?? null };
      await recordWrite(effect.path, "started", { parents, beforeStamp: write.beforeStamp });
      writes.set(effect.path, write);
      interruptionPoint("document-source-edit", "started:" + effect.path);
    }
    const guard = () => {
      assertAuthority(); assertDirectories(root, edit.directories ?? []); assertDirectories(root, write!.parents ?? []);
      assertEffectState(effect, fileState(root, effect.path), write, baseline.get(effect.path)?.stamp);
    };
    guard();
    if (write.state === "applied") continue;
    const state = fileState(root, effect.path);
    if ((state?.digest ?? null) !== effect.after) {
      if (effect.kind === "delete") {
        guard(); unlinkSync(target);
        interruptionPoint("document-source-edit", "removed:" + effect.path);
      } else await durableReplaceBytes(target, desiredMap.get(effect.path)!.data, 0o600, guard);
    }
    // A recovered deletion still needs its parent barrier before the applied receipt.
    await syncDirectory(dirname(target)); guard();
    interruptionPoint("document-source-edit", "written:" + effect.path);
    const afterStamp = fileState(root, effect.path)?.stamp ?? null;
    await recordWrite(effect.path, "applied", { afterStamp });
    write.state = "applied"; write.afterStamp = afterStamp;
    interruptionPoint("document-source-edit", "applied:" + effect.path);
  }
  const result = await readDesignSet(authority.workspace, operation.revision.path);
  if (result.readSetDigest !== desired.readSetDigest) {
    const changed = [...new Set([...result.files.map(file => file.path), ...desiredMap.keys()])]
      .filter(path => result.files.find(file => file.path === path)?.digest !== desiredMap.get(path)?.digest);
    throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before edit publication", changed.map(file => ({ file, message: "Source changed before publication" })));
  }
  assertAuthority(); assertDirectories(root, edit.directories ?? []);
}
