/**
 * [INPUT]: Depends on local filesystem persistence, a monotonic event order and salted object hashing.
 * [OUTPUT]: Provides a default bounded, expiring recovery timeline and offline snapshots without raw identifiers or errors.
 * [POS]: Main-only diagnostic owner shared by transport, reply and scheduling owners; never blocks their work.
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
const stage = z.enum(["control-auth", "bulk-auth", "capture", "chunks", "body", "settlement", "remote", "capabilities", "preparation", "memory", "sync", "chat-queue", "presence"]);
const code = z.enum(["started", "ready", "progress", "failed", "retrying", "closed", "superseded", "blocked", "timed-out", "invalid-session"]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const eventSchema = z.object({ stage, code, object: z.string().regex(/^[a-f0-9]{16}$/).optional(), firstAt: count, lastAt: count,
  count, attempt: count.optional(), retryAt: count.optional(), progress: count.optional() }).strict();
type Event = z.infer<typeof eventSchema>;
export type RecoveryEvent = Pick<Event, "stage" | "code" | "attempt" | "retryAt" | "progress"> & { objectId?: string };
const LIMIT = 128, MAX_AGE = 24 * 60 * 60 * 1000;
export class RecoveryDiagnostics {
  private readonly salt = randomBytes(32);
  private events: Event[] = [];
  private file: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<void> | null = null;
  private revision = 0;
  private persistedRevision = -1;
  constructor(private readonly now = Date.now) {}
  private prune() { const floor = this.now() - MAX_AGE; this.events = this.events.filter(event => event.lastAt >= floor).slice(-LIMIT); }
  record(input: RecoveryEvent) {
    const at = this.now(); this.prune();
    const object = input.objectId ? createHmac("sha256", this.salt).update(input.objectId).digest("hex").slice(0, 16) : undefined;
    const candidate = eventSchema.parse({ stage: input.stage, code: input.code, object, firstAt: at, lastAt: at, count: 1,
      attempt: input.attempt, retryAt: input.retryAt, progress: input.progress });
    const previous = this.events.at(-1);
    if (previous && previous.stage === candidate.stage && previous.code === candidate.code && previous.object === object) {
      this.events[this.events.length - 1] = { ...candidate, firstAt: previous.firstAt, count: Math.min(Number.MAX_SAFE_INTEGER, previous.count + 1) };
    } else this.events.push(candidate);
    this.prune(); this.revision++;
    if (this.file && !this.timer) { this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 5_000); this.timer.unref(); }
  }
  snapshot() { this.prune(); return { capturedAt: this.now(), retentionMs: MAX_AGE, capacity: LIMIT, events: structuredClone(this.events) }; }
  async retainIn(directory: string) {
    if (this.file) return;
    const file = join(directory, "cloud-recovery.json");
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(file).catch(() => null);
      if (stat?.isSymbolicLink()) return;
      if (stat && stat.size <= 128_000) {
        const stored = z.object({ events: z.array(eventSchema).max(LIMIT) }).passthrough().parse(JSON.parse(await readFile(file, "utf8")));
        this.events = [...stored.events, ...this.events]; this.prune();
      }
    } catch { /* Diagnostics never prevent account startup. */ }
    this.file = file;
  }
  flush() {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    const file = this.file;
    if (!file) return Promise.resolve();
    if (this.writes) return this.writes;
    this.writes = (async () => {
      while (this.persistedRevision !== this.revision) {
        const revision = this.revision, data = JSON.stringify(this.snapshot()) + "\n";
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, data, { mode: 0o600 }); await rename(temporary, file); this.persistedRevision = revision;
      }
    })().catch(() => {}).finally(() => { this.writes = null; });
    return this.writes;
  }
}
export const recoveryDiagnostics = new RecoveryDiagnostics();
