/**
 * [INPUT]: Depends on Node fs/os/path, zod, the durable atomic file primitive, and the native preference value schema.
 * [OUTPUT]: Provides the user-level recovery directory (~/.bottega/system-dock), the takeover journal schema shared byte-for-byte with the recovery agent, the cross-profile kernel owner lock (O_EXLOCK, released by the OS on exit) with a `holds` proof, the monotonic epoch counter, the last-result record, and the conditional-restore planner.
 * [POS]: system-dock/replacement persistence boundary (INV-04/05); the agent reads the same files, so the format is versioned and never guessed when corrupt.
 */

import { constants } from "node:fs";
import { mkdir, open, readFile, rm, stat, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode } from "../../persistence/durable-json";
import { DOCK_PREF_KEYS, type DockPrefKey, type PrefValue } from "../native/protocol";

export const RECOVERY_FILES = { journal: "recovery.json", lock: "owner.lock", epoch: "epoch", lastResult: "last-result.json" } as const;
export function recoveryDirectory(home = homedir()) { return join(home, ".bottega", "system-dock"); }

const scalar = z.union([z.boolean(), z.number(), z.string(), z.null()]);
export const managedFieldSchema = z.object({ key: z.enum(DOCK_PREF_KEYS), originalPresent: z.boolean(), originalType: z.enum(["bool", "real", "int", "string", "other", "missing"]),
  originalValue: scalar, writtenType: z.enum(["bool", "real", "int"]), writtenValue: z.union([z.boolean(), z.number()]), written: z.boolean() }).strict();
export const ownerSchema = z.object({ installation: z.string().min(1).max(128), profile: z.string().min(1).max(128), pid: z.number().int().positive(),
  startedAt: z.number().int().nonnegative(), appPath: z.string().max(4096) }).strict();
export const journalSchema = z.object({ version: z.literal(1), operationId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/), ownershipEpoch: z.number().int().positive(),
  phase: z.enum(["preparing", "active", "restoring"]), consentVersion: z.number().int().positive(), owner: ownerSchema,
  fields: z.array(managedFieldSchema).max(DOCK_PREF_KEYS.length), reload: z.boolean(), updatedAt: z.number().int().nonnegative() }).strict();
export const lastResultSchema = z.object({ version: z.literal(1), operationId: z.string().max(64), result: z.enum(["restored", "kept-external", "failed"]),
  by: z.enum(["main", "agent"]), at: z.number().int().nonnegative() }).strict();
export type ManagedField = z.infer<typeof managedFieldSchema>;
export type RecoveryJournal = z.infer<typeof journalSchema>;
export type RecoveryOwner = z.infer<typeof ownerSchema>;
export type LastResult = z.infer<typeof lastResultSchema>;
export type JournalRead = { kind: "none" } | { kind: "ok"; journal: RecoveryJournal } | { kind: "corrupt" };

/* Darwin <fcntl.h> O_EXLOCK: open with an exclusive flock. Node does not export it; the Dock only runs on macOS. */
const O_EXLOCK = 0x20;

export class RecoveryFiles {
  private lock: FileHandle | null = null;
  constructor(readonly directory = recoveryDirectory()) {}
  private path(name: keyof typeof RECOVERY_FILES) { return join(this.directory, RECOVERY_FILES[name]); }
  /** The agent accepts only its own `<dir>/recovery.json`; anything else is rejected as invalid. */
  get journalPath() { return this.path("journal"); }
  async ensure() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  /** A corrupt journal is evidence, not a value: callers suspend instead of guessing (INV-04). */
  async readJournal(): Promise<JournalRead> {
    let raw: string;
    try { raw = await readFile(this.path("journal"), "utf8"); } catch (cause) { if (isErrnoCode(cause, "ENOENT")) return { kind: "none" }; throw cause; }
    try { const parsed = journalSchema.safeParse(JSON.parse(raw)); return parsed.success ? { kind: "ok", journal: parsed.data } : { kind: "corrupt" }; }
    catch { return { kind: "corrupt" }; }
  }
  async writeJournal(journal: RecoveryJournal) { await this.ensure(); await durableReplaceFile(this.path("journal"), `${JSON.stringify(journalSchema.parse(journal))}\n`); }
  async clearJournal() { await rm(this.path("journal"), { force: true }); }
  async readLastResult(): Promise<LastResult | null> {
    try { const parsed = lastResultSchema.safeParse(JSON.parse(await readFile(this.path("lastResult"), "utf8"))); return parsed.success ? parsed.data : null; }
    catch { return null; }
  }
  async writeLastResult(result: LastResult) { await this.ensure(); await durableReplaceFile(this.path("lastResult"), `${JSON.stringify(result)}\n`); }
  /** Epochs only grow; the agent rejects any request below the highest it has seen. */
  async nextEpoch(): Promise<number> {
    await this.ensure();
    let current = 0;
    try { current = Number.parseInt((await readFile(this.path("epoch"), "utf8")).trim(), 10) || 0; } catch (cause) { if (!isErrnoCode(cause, "ENOENT")) throw cause; }
    const next = current + 1;
    await durableReplaceFile(this.path("epoch"), `${next}\n`);
    return next;
  }
  /**
   * Cross-profile exclusivity (INV-05): stable, Cloud Dev and every profile share this lock. It is a kernel `flock`
   * taken with O_EXLOCK|O_NONBLOCK and held on an open descriptor for the whole takeover, so the OS releases it the
   * moment the holder exits or crashes. Nothing is ever judged stale or reclaimed, which removes the reclaim races
   * a pid/start-time lock file had. The file's bytes are only a diagnostic of who holds it.
   */
  async acquireLock(owner: RecoveryOwner): Promise<{ ok: true } | { ok: false; holder: RecoveryOwner | null }> {
    if (this.lock) return { ok: true };
    await this.ensure();
    let handle: FileHandle;
    try { handle = await open(this.path("lock"), constants.O_RDWR | constants.O_CREAT | O_EXLOCK | constants.O_NONBLOCK, 0o600); }
    catch (cause) {
      if (isErrnoCode(cause, "EAGAIN") || isErrnoCode(cause, "EWOULDBLOCK")) return { ok: false, holder: await this.readLock() };
      throw cause;
    }
    try {
      await handle.truncate(0);
      await handle.write(`${JSON.stringify(owner)}\n`, 0);
      await handle.sync();
    } catch (cause) { await handle.close().catch(() => undefined); throw cause; }
    this.lock = handle;
    return { ok: true };
  }
  /** True while this instance still has its descriptor, i.e. still holds the kernel lock. */
  async holds(): Promise<boolean> { return this.lock !== null; }
  async readLock(): Promise<RecoveryOwner | null> {
    try { const parsed = ownerSchema.safeParse(JSON.parse(await readFile(this.path("lock"), "utf8"))); return parsed.success ? parsed.data : null; }
    catch { return null; }
  }
  /** Closing the descriptor releases the lock; the file stays, so no path ever disappears under a waiting instance. */
  async releaseLock() {
    const lock = this.lock; this.lock = null;
    await lock?.close().catch(() => undefined);
  }
  async exists(): Promise<boolean> { try { await stat(this.path("journal")); return true; } catch { return false; } }
}

export type RestoreStep = { key: DockPrefKey; action: "delete" } | { key: DockPrefKey; action: "set"; type: "bool" | "real" | "int"; value: boolean | number } | { key: DockPrefKey; action: "keep-external" };
function equalsWritten(current: PrefValue, field: ManagedField) {
  if (!current.present) return false;
  if (field.writtenType === "bool") return current.type === "bool" && current.value === field.writtenValue;
  return (current.type === "real" || current.type === "int") && typeof current.value === "number" && Math.abs(current.value - Number(field.writtenValue)) < 1e-9;
}
/**
 * Conditional restore (INV-04): only a field that still holds exactly what we wrote is ours to
 * put back. A missing original becomes a delete; an external change is kept and ownership dropped.
 */
export function planRestore(fields: readonly ManagedField[], current: Record<DockPrefKey, PrefValue>): RestoreStep[] {
  return fields.filter((field) => field.written).map((field): RestoreStep => {
    if (!equalsWritten(current[field.key], field)) return { key: field.key, action: "keep-external" };
    if (!field.originalPresent) return { key: field.key, action: "delete" };
    if ((field.originalType === "bool" && typeof field.originalValue === "boolean") || ((field.originalType === "real" || field.originalType === "int") && typeof field.originalValue === "number"))
      return { key: field.key, action: "set", type: field.originalType, value: field.originalValue };
    // An original of an unexpected type was refused at takeover; reaching here means the journal lies.
    return { key: field.key, action: "keep-external" };
  });
}
