/**
 * [INPUT]: Depends on the existing disposable Kimi home and native state-root helpers.
 * [OUTPUT]: Prepares shared credential/OAuth directories and explicit read/write sandbox grants.
 * [POS]: Query-only topology; never links server.token or changes readiness/headless homes.
 */
import { lstat, readdir, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createDisposableKimiHome, resolveKimiCodeHome } from "../../backends/kimi/home";
export async function createQuotaKimiHome(sourceRoot = resolveKimiCodeHome()) {
  const source = await realpath(sourceRoot).catch(() => sourceRoot);
  const home = await createDisposableKimiHome(source);
  const stateWriteRoots: string[] = [];
  const readOnlyRoots: string[] = [];
  try {
    for (const name of await readdir(home.path)) {
      const path = join(source, name);
      if (name === "credentials" || name === "oauth") {
        const info = await lstat(path);
        if (!info.isDirectory() && !info.isSymbolicLink()) throw new Error("Invalid authentication directory");
        const target = join(home.path, name);
        await rm(target, { recursive: true, force: true });
        await symlink(path, target, "dir");
        stateWriteRoots.push(path);
      } else readOnlyRoots.push(path);
    }
    return { ...home, readOnlyRoots, stateWriteRoots };
  } catch (cause) { await home.release(); throw cause; }
}
