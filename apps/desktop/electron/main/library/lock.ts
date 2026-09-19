/**
 * [INPUT]: Depends on atomic directories, process liveness and installation identity.
 * [OUTPUT]: Acquires an exclusive folder lock, retains active owners regardless of heartbeat age, and reports loss only after a transient stat failure persists.
 * [POS]: Cross-profile single-writer boundary; a copied lock from another host expires without carrying authority.
 */
import { randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { hostname } from "node:os";
import { lstat, mkdir, open, readFile, rename, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode } from "../persistence/durable-json";

const ownerSchema = z.object({ pid: z.number().int().positive(), installationId: z.string(), host: z.string(), token: z.string(), heartbeatAt: z.number(),
  folder: z.object({ dev: z.number(), ino: z.number() }) });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return !isErrnoCode(error, "ESRCH"); } };
const same = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) => a.dev === b.dev && a.ino === b.ino;

export class LibraryLockedError extends Error {
  override name = "LibraryLockedError";
  readonly code = "locked";
  constructor() { super("LIBRARY_IN_USE: This folder is open in another Bottega instance. Close it there, then retry."); }
}

export async function acquireLibraryLock(control: string, installationId: string) {
  const path = join(control, "lock"), token = randomUUID();
  const folder = await lstat(control);
  const staging = join(control, `lock-${token}`);
  await mkdir(staging, { mode: 0o700 });
  await durableReplaceFile(join(staging, "owner.json"), JSON.stringify({ pid: process.pid, installationId, host: hostname(), token, heartbeatAt: Date.now(),
    folder: { dev: folder.dev, ino: folder.ino } }) + "\n");
  try {
  for (let attempt = 0; ; attempt++) {
    // Publish an already populated directory, so a stalled creator never looks like a dead empty lock.
    try { await rename(staging, path); break; }
    catch (error) { if (!isErrnoCode(error, "EEXIST") && !isErrnoCode(error, "ENOTEMPTY")) throw error; }
    if (attempt >= 3) throw new LibraryLockedError();
    const identity = await lstat(path).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
    if (!identity) continue;
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new LibraryLockedError();
    let owner;
    try { owner = ownerSchema.parse(JSON.parse(await readFile(join(path, "owner.json"), "utf8"))); }
    catch { if (Date.now() - identity.mtimeMs < 60_000) throw new LibraryLockedError(); }
    if (owner && same(owner.folder, folder) && (owner.host === hostname() ? alive(owner.pid) : Date.now() - identity.mtimeMs < 60_000)) throw new LibraryLockedError();
    // Only one contender may retire this exact dead owner's directory. Recheck
    // its inode after election so a contender cannot retire the next owner.
    const elected = await electReaper(path);
    if (!elected) continue;
    await elected.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
    await elected.sync(); await elected.close();
    if (!same(identity, await lstat(path))) throw new LibraryLockedError();
    const retired = join(control, `expired-lock-${token}`);
    await rename(path, retired);
    await rm(retired, { recursive: true });
  }
  } finally { await rm(staging, { recursive: true, force: true }); }
  const identity = await lstat(path);
  let failure: Error | null = null, closed = false, verifiedAt = Date.now();
  const held = (info: { dev: number; ino: number } | null) => {
    if (!info || !same(identity, info)) return false;
    verifiedAt = Date.now(); failure = null; return true;
  };
  /* Sleep, an unmounted volume and a backup snapshot all produce a stat that fails once
     and succeeds a moment later. Latching on the first failure turns any of them into a
     permanently dead folder, so ownership is only lost once it stays lost. */
  const confirmLost = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500).unref());
      if (held(await lstat(path).catch(() => null))) return false;
    }
    return true;
  };
  const check = async () => {
    if (closed) return;
    if (!held(await lstat(path).catch(() => null)) && await confirmLost()) {
      failure = new Error("LIBRARY_LOCK_LOST");
      return;
    }
    if (closed) return;
    const now = new Date(); await utimes(path, now, now).catch(() => {});
  };
  const timer = setInterval(() => void check(), 10_000); timer.unref();
  return {
    /* Every `library.root` read calls this; the heartbeat above is the real detector, so a
       synchronous stat once per second is enough to fence an operation that just started. */
    assertOwned() {
      if (closed) throw new Error("LIBRARY_CLOSED");
      const now = Date.now();
      if (!failure && now - verifiedAt < 1_000) return;
      let info: { dev: number; ino: number } | null = null;
      try { info = lstatSync(path); } catch { info = null; }
      if (held(info)) return;
      if (!failure) failure = new Error("LIBRARY_LOCK_LOST");
      throw failure;
    },
    async close() {
      if (closed) return; closed = true; clearInterval(timer);
      try { if (same(identity, await lstat(path))) await rm(path, { recursive: true }); }
      catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
    },
  };
}

async function electReaper(path: string) {
  let name = "reaping";
  for (let depth = 0; depth < 256; depth++) {
    const candidate = join(path, name);
    try { return await open(candidate, "wx", 0o600); }
    catch (error) { if (isErrnoCode(error, "ENOENT")) return null; if (!isErrnoCode(error, "EEXIST")) throw error; }
    const identity = await lstat(candidate).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
    if (!identity) return null;
    if (!identity.isFile() || identity.isSymbolicLink()) throw new LibraryLockedError();
    const reaper = await readFile(candidate, "utf8").then(value => { try { return JSON.parse(value); } catch { return null; } });
    if (reaper?.host === hostname() && Number.isInteger(reaper.pid) && alive(reaper.pid) || Date.now() - identity.mtimeMs < 60_000) throw new LibraryLockedError();
    // Never unlink an election by pathname: a second contender could replace it between check and unlink.
    // Dead elections remain immutable; all contenders compete for the same next inode-derived claim.
    name = `reaping-${identity.dev}-${identity.ino}`;
  }
  throw new LibraryLockedError();
}
