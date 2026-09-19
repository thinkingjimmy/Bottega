/**
 * [INPUT]: Depends on an explicit SQLite worker failure, a validated folder identity and a fully closed connection.
 * [OUTPUT]: Preserves the complete database/WAL/SHM family before a fresh database is created on relaunch.
 * [POS]: Recovery boundary; unrelated ledger, key or filesystem failures can never request a SQLite rebuild.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { libraryIdentitySchema } from "../../library/identity";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../persistence/durable-json";
export async function canRebuildFromFolder(error: unknown, root: string | null) {
  if (!(error instanceof Error) || error.name !== "ChatDatabaseError" || !root) return false;
  const failure = (error as Error & { failure?: { kind?: string } }).failure;
  if (failure?.kind !== "corrupt" && failure?.kind !== "future-schema") return false;
  try {
    const path = join(root, ".bottega/library.json"), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) return false;
    return libraryIdentitySchema.safeParse(JSON.parse(await readFile(path, "utf8"))).success;
  } catch { return false; }
}
const family = ["bottega.sqlite3", "bottega.sqlite3-wal", "bottega.sqlite3-shm"] as const;
const intentSchema = z.object({ version: z.literal(1), id: z.string().regex(/^\d{13}-[a-f0-9-]{36}$/), files: z.array(z.enum(family)).max(3), preservedAt: z.number().int().nonnegative() });
async function exists(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("SQLITE_RECOVERY_FILE_INVALID");
    return true;
  } catch (error) { if (isErrnoCode(error, "ENOENT")) return false; throw error; }
}
/** Resumes only an already-authorized rebuild, before any SQLite connection is opened. */
export async function resumeDatabasePreservation(userData: string) {
  const pending = join(userData, "recovery", "sqlite-pending.json");
  if (!await exists(pending)) return null;
  const intent = intentSchema.parse(JSON.parse(await readFile(pending, "utf8")));
  if (new Set(intent.files).size !== intent.files.length) throw new Error("SQLITE_RECOVERY_INTENT_INVALID");
  const directory = join(userData, "recovery", "sqlite"), target = join(directory, intent.id);
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const name of intent.files) {
    const source = join(userData, name), destination = join(target, name);
    const [atSource, atDestination] = await Promise.all([exists(source), exists(destination)]);
    if (atSource === atDestination) throw new Error("SQLITE_RECOVERY_FAMILY_AMBIGUOUS");
    if (atSource) await rename(source, destination);
    await syncDirectory(target); await syncDirectory(userData);
  }
  await durableReplaceFile(join(target, "recovery.json"), JSON.stringify(intent) + "\n");
  await rm(pending); await syncDirectory(join(userData, "recovery"));
  const retained = (await readdir(directory, { withFileTypes: true })).filter(item => item.isDirectory() && /^\d{13}-[a-f0-9-]{36}$/.test(item.name)).sort((a, b) => b.name.localeCompare(a.name));
  for (const old of retained.slice(3)) {
    try { intentSchema.parse(JSON.parse(await readFile(join(directory, old.name, "recovery.json"), "utf8"))); }
    catch { continue; }
    await rm(join(directory, old.name), { recursive: true });
  }
  await syncDirectory(directory); return target;
}
export async function preserveClosedDatabase(userData: string) {
  const resumed = await resumeDatabasePreservation(userData);
  if (resumed) return resumed;
  const directory = join(userData, "recovery");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const files = [];
  for (const name of family) if (await exists(join(userData, name))) files.push(name);
  await durableReplaceFile(join(directory, "sqlite-pending.json"), JSON.stringify({ version: 1, id: `${Date.now()}-${randomUUID()}`, files, preservedAt: Date.now() }) + "\n");
  return resumeDatabasePreservation(userData);
}
