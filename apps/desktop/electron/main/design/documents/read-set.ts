/**
 * [INPUT]: Main-authorized workspace roots, source limits and no-follow Node filesystem handles.
 * [OUTPUT]: Complete no-follow design/design-system byte sets and a 1s quiet check sampled at 500ms, bounded to 10s.
 * [POS]: Document source capture; filesystem quiet never substitutes for writer completion or commit CAS.
 */
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DESIGN_LIMITS, DesignDocumentError, designDigest, sourcePath,
  type DesignReadSet, type DesignSourceFile } from "./model";

const stamp = (value: Stats) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`;
export async function readDesignSet(workspace: string, path: string): Promise<DesignReadSet> {
  if (!/^(?:design|design-systems)\/[a-z0-9][a-z0-9_-]{0,63}$/.test(path)) throw new DesignDocumentError("PATH_DENIED", "Invalid document directory");
  const workspaceRoot = await realpath(workspace), root = join(workspaceRoot, path);
  try {
    for (const directory of [join(workspaceRoot, path.split("/")[0]!), root]) {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory)
        throw new DesignDocumentError("PATH_DENIED", "Document directories cannot contain symbolic links");
    }
    const files: DesignSourceFile[] = [];
    const directories = new Map<string, string>();
    let total = 0, nodes = 0;
    const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
      if (depth > 3) throw new DesignDocumentError("PATH_DENIED", "Document path depth exceeds the archive contract");
      const before = await lstat(directory);
      if (before.isSymbolicLink() || !before.isDirectory() || await realpath(directory) !== directory)
        throw new DesignDocumentError("PATH_DENIED", "Symbolic links are not document resources");
      directories.set(directory, stamp(before));
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
        if (++nodes > 256) throw new DesignDocumentError("BUDGET_EXCEEDED", "Document directory count exceeds its capture budget");
        const name = prefix + entry.name, absolute = join(directory, entry.name);
        if (!sourcePath.safeParse(name).success) throw new DesignDocumentError("PATH_DENIED", `Invalid resource path: ${name.slice(0, 240)}`);
        const metadata = await lstat(absolute);
        if (metadata.isSymbolicLink()) throw new DesignDocumentError("PATH_DENIED", "Symbolic links are not document resources");
        if (metadata.isDirectory()) { await walk(absolute, name + "/", depth + 1); continue; }
        if (!metadata.isFile() || await realpath(absolute) !== absolute)
          throw new DesignDocumentError("PATH_DENIED", "Document resources must be regular files");
        const limit = name === "canvas.json" ? DESIGN_LIMITS.manifest : /\.html$/i.test(name) ? DESIGN_LIMITS.html : DESIGN_LIMITS.source;
        if (files.length >= DESIGN_LIMITS.files || metadata.size > limit || total + metadata.size > DESIGN_LIMITS.source)
          throw new DesignDocumentError("BUDGET_EXCEEDED", "Document exceeds its file or byte budget");
        const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await handle.stat();
          if (stamp(opened) !== stamp(metadata)) throw new DesignDocumentError("SOURCE_CHANGED", "Source changed before opening");
          const data = Buffer.alloc(metadata.size);
          let offset = 0;
          while (offset < data.length) {
            const result = await handle.read(data, offset, Math.min(64 * 1024, data.length - offset), offset);
            if (!result.bytesRead) throw new DesignDocumentError("SOURCE_CHANGED", "Source was truncated during capture");
            offset += result.bytesRead;
          }
          if (stamp(await handle.stat()) !== stamp(metadata) || stamp(await lstat(absolute)) !== stamp(metadata))
            throw new DesignDocumentError("SOURCE_CHANGED", "Source changed during capture");
          files.push({ path: name, data, digest: designDigest(data), stamp: stamp(metadata) }); total += data.length;
        } finally { await handle.close(); }
      }
    };
    await walk(root, "", 0);
    for (const [directory, prior] of directories) {
      if (stamp(await lstat(directory)) !== prior || await realpath(directory) !== directory)
        throw new DesignDocumentError("SOURCE_CHANGED", "Source directory changed during capture");
    }
    const sorted = files.sort((a, b) => a.path < b.path ? -1 : 1);
    return { path, files: sorted, bytes: total,
      readSetDigest: designDigest(JSON.stringify(sorted.map(file => [file.path, file.data.length, file.digest]))) };
  } catch (cause) {
    if (cause instanceof DesignDocumentError) throw cause;
    const code = (cause as NodeJS.ErrnoException).code;
    throw new DesignDocumentError(code === "ENOENT" ? "NOT_READY" : "PATH_DENIED",
      code === "ENOENT" ? "Document files are not ready" : "Document source cannot be read safely");
  }
}

export async function stableDesignSet(workspace: string, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(DESIGN_LIMITS.waitMs)]);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.aborted ? signal.reason : new DesignDocumentError("NOT_READY", "Files are still changing. No new version has been saved."));
    bounded.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([waitForStableSet(workspace, path, bounded), aborted]); }
  finally { bounded.removeEventListener("abort", onAbort); }
}

async function waitForStableSet(workspace: string, path: string, signal: AbortSignal) {
  const started = Date.now();
  let previous: string | null = null, stableSince = started;
  while (Date.now() - started <= DESIGN_LIMITS.waitMs) {
    signal.throwIfAborted();
    try {
      const current = await readDesignSet(workspace, path);
      const identity = JSON.stringify([current.readSetDigest, current.files.map(file => file.stamp)]);
      if (identity !== previous) { previous = identity; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= DESIGN_LIMITS.stableMs && Date.now() - started <= DESIGN_LIMITS.waitMs)
        return { readSet: current, waitedMs: Date.now() - started };
    } catch (cause) {
      if (!(cause instanceof DesignDocumentError) || !["SOURCE_CHANGED", "NOT_READY"].includes(cause.code)) throw cause;
      previous = null; stableSince = Date.now();
    }
    const remaining = DESIGN_LIMITS.waitMs - (Date.now() - started);
    if (remaining <= 0) break;
    await delay(Math.min(DESIGN_LIMITS.intervalMs, remaining), undefined, { signal });
  }
  throw new DesignDocumentError("NOT_READY", "Files are still changing. No new version has been saved.");
}
