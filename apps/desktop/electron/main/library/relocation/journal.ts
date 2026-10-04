/**
 * [INPUT]: Depends on zod and the durable single-file replace primitive.
 * [OUTPUT]: Provides the relocation journal in userData: read, write, mark cancelled and clear of one pending `move` or `adopt` request.
 * [POS]: The only hand-off between the process that asks for a relocation and the next launch that performs it.
 */
import { readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode } from "../../persistence/durable-json";

/* Platform-aware: a `C:\\` folder is as absolute as `/Users/…`, and discarding its adopt journal looped the missing-folder dialog (F-25). */
const absolutePath = z.string().min(2).max(4096).refine((value) => isAbsolute(value), "absolute path required");

/* `move` carries the folder itself to `to`; `adopt` means the folder already lives at `to`
   (startup recovery located it) and only this profile's recorded paths have to follow. */
export const relocationSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["move", "adopt"]),
  from: absolutePath,
  to: absolutePath,
  libraryId: z.string().uuid().nullable(),
  requestedAt: z.number().int().nonnegative(),
  /* Set the moment the person cancels a copy across volumes, before anything is cleaned up: a launch that finds it
     only removes this move's own staging copy and leaves the folder where it was (F-24). */
  cancelled: z.literal(true).optional(),
}).strict();
export type Relocation = z.infer<typeof relocationSchema>;

export const relocationPath = (userData: string) => join(userData, "library-relocation.json");

export async function readRelocation(userData: string): Promise<Relocation | null> {
  let text: string;
  try { text = await readFile(relocationPath(userData), "utf8"); }
  catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
  let value: unknown = null;
  try { value = JSON.parse(text); } catch { /* Falls through to the same discard as a schema mismatch. */ }
  const parsed = relocationSchema.safeParse(value);
  if (!parsed.success) {
    // A journal nothing can act on must not wedge every launch; the folder stays where settings say.
    console.warn("[library] unreadable relocation journal discarded");
    await clearRelocation(userData);
    return null;
  }
  return parsed.data;
}

export const writeRelocation = (userData: string, relocation: Omit<Relocation, "version" | "requestedAt">) =>
  durableReplaceFile(relocationPath(userData), JSON.stringify({ version: 1, ...relocation, requestedAt: Date.now() }) + "\n");

export const clearRelocation = (userData: string) => rm(relocationPath(userData), { force: true });

export async function markRelocationCancelled(userData: string) {
  const journal = await readRelocation(userData);
  if (!journal || journal.kind !== "move" || journal.cancelled) return;
  await durableReplaceFile(relocationPath(userData), JSON.stringify({ ...journal, cancelled: true }) + "\n");
}
