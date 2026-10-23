/**
 * [INPUT]: Prepared immutable archive, original source digests and current main authority.
 * [OUTPUT]: Complete transformed read sets, conflict paths and guarded writes with durable intent/completion callbacks.
 * [POS]: Existing document journal's edit effect; no second registry or publication protocol.
 */
import { constants, openSync, closeSync, fstatSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { realpath } from "node:fs/promises";
import { mkdir, lstat } from "node:fs/promises";
import { unpackArtifactArchive } from "@ai-chat/cloud-protocol/artifacts/archive";
import { durableReplaceBytes } from "../../persistence/durable-json";
import { readDesignSet } from "./read-set";
import { DESIGN_LIMITS, DesignDocumentError, designDigest, sourcePath, type DesignReadSet } from "./model";
import type { DesignOperation } from "./store";
import { interruptionPoint } from "../../startup/boot/composition-hooks";
export function transformedDesignSet(path: string, input: readonly { path: string; data: Uint8Array }[]): DesignReadSet {
  if (input.length > DESIGN_LIMITS.files || new Set(input.map(file => file.path)).size !== input.length) throw new DesignDocumentError("BUDGET_EXCEEDED", "Edit exceeds the document file budget");
  const files = input.map(file => {
    sourcePath.parse(file.path);
    if (file.path === "canvas.json" && file.data.length > DESIGN_LIMITS.manifest || /\.html$/i.test(file.path) && file.data.length > DESIGN_LIMITS.html) throw new DesignDocumentError("BUDGET_EXCEEDED", "Edited file exceeds its budget");
    return { path: file.path, data: Buffer.from(file.data), digest: designDigest(file.data), stamp: "prepared-edit" };
  }).sort((a, b) => a.path < b.path ? -1 : 1);
  const bytes = files.reduce((total, file) => total + file.data.length, 0);
  if (bytes > DESIGN_LIMITS.source) throw new DesignDocumentError("BUDGET_EXCEEDED", "Edit exceeds the source budget");
  return { path, files, bytes, readSetDigest: designDigest(JSON.stringify(files.map(file => [file.path, file.data.length, file.digest]))) };
}
export async function applyPreparedDesignEdit(operation: DesignOperation, archive: Uint8Array, assertAuthority: () => void,
  recordWrite: (path: string, state: "started" | "applied") => Promise<unknown>) {
  const edit = operation.sourceEdit; if (!edit || edit.applied) return;
  const authority = operation.revision.authority, root = join(await realpath(authority.workspace), operation.revision.path);
  const desired = transformedDesignSet(operation.revision.path, unpackArtifactArchive(archive));
  const baseline = new Map(edit.baseline.map(file => [file.path, file.digest]));
  const desiredMap = new Map(desired.files.map(file => [file.path, file]));
  if (edit.initial) {
    let directory = await realpath(authority.workspace);
    for (const segment of operation.revision.path.split("/")) {
      directory = join(directory, segment);
      await mkdir(directory, { mode: 0o700 }).catch(cause => { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; });
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new DesignDocumentError("PATH_DENIED", "Initial source directory changed");
      assertAuthority();
    }
  }
  const current = await readDesignSet(authority.workspace, operation.revision.path);
  const changed = [...current.files.filter(file => !desiredMap.has(file.path) || file.digest !== baseline.get(file.path) && file.digest !== desiredMap.get(file.path)!.digest).map(file => file.path),
    ...edit.baseline.filter(file => !current.files.some(value => value.path === file.path)).map(file => file.path)];
  if (changed.length) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed during the saved edit. Input and the prepared archive are retained.", changed.map(file => ({ file, message: "Source differs from the prepared baseline and result" })));
  for (const file of desired.files) {
    const previous = current.files.find(value => value.path === file.path); if (previous?.digest === file.digest) continue;
    interruptionPoint("document-source-edit", "before:" + file.path);
    const target = join(root, file.path);
    const guard = () => {
      assertAuthority();
      let parent = dirname(target); while (!existsSync(parent) && parent !== root) parent = dirname(parent);
      if (realpathSync(root) !== root || realpathSync(parent) !== parent) throw new DesignDocumentError("PATH_DENIED", "Edit path authority changed");
      if (!existsSync(target)) { if (baseline.has(file.path)) throw new DesignDocumentError("SOURCE_CHANGED", "Source was removed before saving", [{ file: file.path, message: "Source was removed" }]); return; }
      const handle = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(handle); if (!stat.isFile() || stat.size > DESIGN_LIMITS.source) throw new DesignDocumentError("PATH_DENIED", "Edit target is not a bounded regular file");
        const digest = designDigest(readFileSync(handle));
        if (digest !== baseline.get(file.path) && digest !== file.digest) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before the atomic write", [{ file: file.path, message: "Source changed before the atomic write" }]);
      } finally { closeSync(handle); }
    };
    guard();
    // An interrupted atomic write remains a possible effect until the journal acknowledges it.
    await recordWrite(file.path, "started");
    interruptionPoint("document-source-edit", "started:" + file.path);
    await durableReplaceBytes(target, file.data, 0o600, guard);
    interruptionPoint("document-source-edit", "written:" + file.path);
    await recordWrite(file.path, "applied");
  }
  const result = await readDesignSet(authority.workspace, operation.revision.path);
  if (result.readSetDigest !== desired.readSetDigest) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before edit publication", result.files.filter(file => file.digest !== desiredMap.get(file.path)?.digest).map(file => ({ file: file.path, message: "Source changed before publication" })));
  assertAuthority();
}
