/**
 * [INPUT]: Depends on node:fs/path, zod and the durable JSON writer (persistence/durable-json).
 * [OUTPUT]: Provides fileTrustState: the monotonic floor (highest root and snapshot versions accepted) in <userData>/extension-trust/state.json, raised at once in memory and written durably in order (flush awaits it); a file that cannot be read is `readable: false`, which the verifier turns into local confirmation, and it is kept, never overwritten.
 * [POS]: extensions/trust's persisted TrustState (TASK-14 S7 part 3a); the verifier stays pure and takes the state as a port.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../../persistence/durable-json";
import type { TrustState, TrustVersions } from "./verifier";

const stateSchema = z.object({ schema: z.literal("bottega.extension-trust-state/v1"),
  rootVersion: z.number().int().min(0), snapshotVersion: z.number().int().min(0) }).strict();

export function fileTrustState(userData: string): TrustState & { readable: boolean; flush(): Promise<void> } {
  const directory = join(userData, "extension-trust"), path = join(directory, "state.json");
  let current: TrustVersions = { rootVersion: 0, snapshotVersion: 0 }, readable = true, pending: Promise<void> = Promise.resolve();
  try {
    const parsed = stateSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (parsed.success) current = { rootVersion: parsed.data.rootVersion, snapshotVersion: parsed.data.snapshotVersion };
    else readable = false;
  } catch (cause) {
    /* No file yet is floor 0; any other failure (unreadable, not JSON) cannot rule out a rollback. */
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") readable = false;
  }
  return {
    get readable() { return readable; },
    read: () => ({ ...current }),
    advance(next) {
      if (!readable) throw new Error("extension trust state is unreadable; it is kept for inspection and never overwritten");
      if (next.rootVersion <= current.rootVersion && next.snapshotVersion <= current.snapshotVersion) return;
      current = { rootVersion: Math.max(current.rootVersion, next.rootVersion), snapshotVersion: Math.max(current.snapshotVersion, next.snapshotVersion) };
      const content = `${JSON.stringify({ schema: "bottega.extension-trust-state/v1", ...current })}\n`;
      pending = pending.then(() => { mkdirSync(directory, { recursive: true }); return durableReplaceFile(path, content); });
    },
    flush: () => pending,
  };
}
