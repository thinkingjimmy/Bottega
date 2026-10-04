/**
 * [INPUT]: Read-only Node directory iteration, folder identities, cancellation and explicit traversal budgets.
 * [OUTPUT]: Finds matching library IDs in bounded common-location searches, with paths, modification times and partial-result facts.
 * [POS]: Library recovery discovery; suggestions never authorize opening or change a folder.
 */
import { lstat, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readLibraryIdentity } from "../identity";

export type LibraryCandidate = { path: string; modifiedAt: number };
export type LibrarySearchResult = { candidates: LibraryCandidate[]; limited: boolean; visitedDirectories: number; visitedEntries: number };
const SKIP = new Set(["Library", "node_modules", "Applications", "AppData", "Windows", "Program Files", "$RECYCLE.BIN"]);

/** Common locations are independent roots so a dense home tree cannot consume their depth allowance. */
async function librarySearchRoots(home: string, expired: () => boolean): Promise<string[]> {
  const roots = [join(home, "Documents"), join(home, "Desktop"), home];
  if (process.platform === "win32") return [...roots, ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(letter => `${letter}:\\`)];
  const parents = process.platform === "darwin" ? ["/Volumes"] : ["/media", "/run/media", "/mnt"];
  for (const parent of parents) {
    if (expired()) break;
    const directory = await opendir(parent).catch(() => null);
    if (!directory) continue;
    try {
      // Linux mounts may sit below a user's directory; search gives each mount parent its own bounded depth.
      for (let count = 0; count < 64 && !expired(); count++) {
        const entry = await directory.read();
        if (!entry) break;
        if (entry.isDirectory() && !entry.isSymbolicLink()) roots.push(join(parent, entry.name));
      }
    } finally { await directory.close().catch(() => {}); }
  }
  return roots;
}

export async function findLibraryCandidates(input: {
  libraryId: string; roots?: readonly string[]; home?: string; maxDepth?: number; timeBudgetMs?: number; maxDirectories?: number; maxEntries?: number; signal?: AbortSignal;
}): Promise<LibrarySearchResult> {
  const result: LibrarySearchResult = { candidates: [], limited: false, visitedDirectories: 0, visitedEntries: 0 };
  const depth = input.maxDepth ?? 4, directories = input.maxDirectories ?? 2500, entries = input.maxEntries ?? 20_000;
  const budget = input.timeBudgetMs ?? 2500, deadline = Date.now() + budget;
  const queue: { path: string; depth: number }[] = [], visited = new Set<string>();
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const expired = () => stopped || !!input.signal?.aborted || Date.now() >= deadline;
  const scan = async () => {
    const roots = input.roots ?? await librarySearchRoots(input.home ?? homedir(), expired);
    if (expired()) { result.limited = true; return; }
    queue.push(...roots.map(path => ({ path, depth: 0 })));
    while (queue.length && !expired()) {
      if (result.visitedDirectories >= directories) { result.limited = true; break; }
      const next = queue.shift()!;
      const info = await lstat(next.path).catch(() => null);
      if (expired()) break;
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      const canonical = await realpath(next.path).catch(() => null);
      if (expired()) break;
      if (!canonical || visited.has(canonical)) continue;
      visited.add(canonical); result.visitedDirectories++;
      const control = await lstat(join(canonical, ".bottega")).catch(() => null);
      if (expired()) break;
      if (control?.isDirectory() && !control.isSymbolicLink()) {
        const identity = await readLibraryIdentity(canonical);
        if (expired()) break;
        if (identity?.libraryId === input.libraryId) {
          const modified = await stat(join(canonical, ".bottega", "library.json")).catch(() => null);
          if (expired()) break;
          result.candidates.push({ path: canonical, modifiedAt: Math.max(info.mtimeMs, control.mtimeMs, modified?.mtimeMs ?? 0) });
        }
        // A Bottega folder is a leaf. Its Projects and dependency trees are not common-location candidates.
        if (identity) continue;
      }
      if (next.depth >= depth) continue;
      const directory = await opendir(canonical).catch(() => null);
      if (!directory) continue;
      try {
        while (!expired()) {
          if (result.visitedEntries >= entries) { result.limited = true; stopped = true; break; }
          const entry = await directory.read();
          if (!entry || expired()) break;
          result.visitedEntries++;
          if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
          if (queue.length + result.visitedDirectories < directories) queue.push({ path: join(canonical, entry.name), depth: next.depth + 1 });
          else result.limited = true;
        }
      } finally { await directory.close().catch(() => {}); }
    }
    if (expired()) result.limited = true;
  };
  // A stalled mount must not stall the recovery window. The abandoned read may finish later, but cannot schedule another read or mutate results.
  let abort = () => {};
  const cancelled = new Promise<void>(resolve => { abort = () => { stopped = true; resolve(); };
    if (input.signal?.aborted) abort(); else input.signal?.addEventListener("abort", abort, { once:true }); });
  try { await Promise.race([scan(), cancelled, new Promise<void>(resolve => { timer = setTimeout(() => { stopped = true; result.limited = true; resolve(); }, Math.max(0, budget)); })]); }
  finally { clearTimeout(timer); stopped = true; input.signal?.removeEventListener("abort", abort); }
  return { ...result, candidates: [...result.candidates].sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path)) };
}
