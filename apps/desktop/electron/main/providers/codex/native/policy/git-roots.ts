/**
 * [INPUT]: Reads bounded local Git pointer files and canonical directory identities.
 * [OUTPUT]: Exports linkedWorktreeWriteRoots, returning only verified Git metadata write roots.
 * [POS]: Main-only native launch preparation; a malformed or forged pointer never expands roots.
 */
import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const inside = (path: string, root: string) => path === root || path.startsWith(root + sep);
async function smallFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 4096) throw new Error("Invalid Git pointer");
    const bytes = Buffer.alloc(4097); let offset = 0;
    while (offset < bytes.length) { const read = await handle.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
    const after = await handle.stat();
    if (offset > 4096 || before.size !== offset || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Git pointer changed while reading");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, offset)).trim();
  } finally { await handle.close(); }
}

export async function linkedWorktreeWriteRoots(workspace: string): Promise<string[]> {
  try {
    const marker = join(await realpath(workspace), ".git");
    if (!(await lstat(marker)).isFile()) return [];
    const match = /^gitdir: (.+)$/.exec(await smallFile(marker));
    if (!match) return [];
    const gitdir = await realpath(resolve(dirname(marker), match[1]!));
    const common = await realpath(resolve(gitdir, await smallFile(join(gitdir, "commondir"))));
    const worktrees = await realpath(join(common, "worktrees"));
    if (!inside(gitdir, worktrees) || dirname(gitdir) !== worktrees || worktrees !== join(common, "worktrees")) return [];
    const reverse = await realpath(resolve(gitdir, await smallFile(join(gitdir, "gitdir"))));
    if (reverse !== await realpath(marker)) return [];
    const head = /^ref: (refs\/heads\/[A-Za-z0-9._/-]+)$/.exec(await smallFile(join(gitdir, "HEAD")));
    if (head?.[1].split("/").some(part => !part || part === "." || part === "..")) return [];
    const candidates = [gitdir, join(common, "objects"), ...(head ? [dirname(join(common, head[1]!)), dirname(join(common, "logs", head[1]!))] : [])];
    const result: string[] = [];
    for (const path of candidates) {
      // Missing ref/log directories use the nearest existing canonical ancestor without granting that ancestor.
      let current = path; const suffix: string[] = [];
      for (;;) {
        try { const canonical = resolve(await realpath(current), ...suffix); if (!inside(canonical, common)) return []; result.push(canonical); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || current === dirname(current)) throw error; suffix.unshift(current.slice(dirname(current).length + 1)); current = dirname(current); }
      }
    }
    return [...new Set(result)];
  } catch { return []; }
}
