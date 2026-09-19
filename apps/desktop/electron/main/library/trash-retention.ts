/**
 * [INPUT]: Depends on Node fs/path, the durable Purge journal schema and the Chat deletion journal directory.
 * [OUTPUT]: Provides libraryTrashCustody and purgeExpiredTrash: a bounded, custody-checked age-out of `<root>/.trash`.
 * [POS]: Retention half of the folder deletion path; trash.ts moves complete objects in, this removes them once nothing owns them.
 */
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { purgeJournalSchema } from "../chat-home/ledger-values";
import { isErrnoCode } from "../persistence/durable-json";

/* A trashed object is the last copy of something the user asked to delete: long
   enough to survive "that was a mistake", short enough that the folder does not
   keep every deletion forever. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
/* One startup pass is maintenance, not a migration. A large backlog drains over
   the next few launches instead of holding the disk for minutes on this one. */
export const TRASH_PURGE_LIMIT = 50;

export type TrashCustody = Readonly<{
  /** Absolute paths an unfinished purge intent still owns. */
  paths: ReadonlySet<string>;
  /** Chats whose purge or deletion intent has not reached its terminal stage. */
  chatIds: ReadonlySet<string>;
}>;

export type TrashPurgeReport = Readonly<{
  removed: number;
  held: number;
  deferred: number;
}>;

/**
 * Reads the two durable owners of trashed content without touching their state.
 * Both are fail-closed on purpose: an unreadable intent counts as live custody,
 * because this is the one caller that must never guess towards deleting.
 */
export async function libraryTrashCustody(userData: string): Promise<TrashCustody> {
  const paths = new Set<string>();
  const chatIds = new Set<string>();
  const journal = await readJson(join(userData, "chat-purge-journal.json"));
  if (journal !== null) {
    for (const intent of Object.values(purgeJournalSchema.parse(journal).intents)) {
      if (intent.phase === "completed") continue;
      for (const path of intent.trashPaths) paths.add(path);
      for (const member of intent.members) chatIds.add(member.chatId);
    }
  }
  const deletions = join(userData, "deletion-journal");
  for (const name of await entries(deletions)) {
    if (!name.endsWith(".json")) continue;
    /* `<chatId>.<incarnationId>.json`, and a Chat id never contains a dot. */
    const chatId = name.slice(0, name.indexOf("."));
    if (!chatId) continue;
    const record = await readJson(join(deletions, name)).catch(() => undefined);
    if ((record as { stage?: unknown } | null | undefined)?.stage !== "cleaned") chatIds.add(chatId);
  }
  return { paths, chatIds };
}

/**
 * Removes `.trash` entries older than the retention window, oldest first, up to
 * `limit` per pass. The rename into `.trash` is what starts the clock, so the age
 * is the entry's own mtime: the content files inside keep the timestamps they had
 * while the object was still live.
 */
export async function purgeExpiredTrash(input: {
  root: string;
  custody: TrashCustody;
  now?: number;
  retentionMs?: number;
  limit?: number;
  cancelled?: () => boolean;
}): Promise<TrashPurgeReport> {
  const {
    root,
    custody,
    now = Date.now(),
    retentionMs = TRASH_RETENTION_MS,
    limit = TRASH_PURGE_LIMIT,
  } = input;
  const trash = join(root, ".trash");
  const expired: Array<{ path: string; mtimeMs: number }> = [];
  let held = 0;
  for (const name of await entries(trash)) {
    const path = join(trash, name);
    if (owned(name, path, custody)) {
      held += 1;
      continue;
    }
    const info = await lstat(path).catch((error) => {
      if (isErrnoCode(error, "ENOENT")) return null;
      throw error;
    });
    if (!info || now - info.mtimeMs < retentionMs) continue;
    expired.push({ path, mtimeMs: info.mtimeMs });
  }
  expired.sort((left, right) => left.mtimeMs - right.mtimeMs);
  let removed = 0;
  for (const entry of expired.slice(0, limit)) {
    if (input.cancelled?.()) break;
    await rm(entry.path, { recursive: true, force: true });
    removed += 1;
  }
  return { removed, held, deferred: expired.length - removed };
}

function owned(name: string, path: string, custody: TrashCustody) {
  if (custody.paths.has(path)) return true;
  /* Chat Home entries are named `<chatId>-<operation>`; matching the prefix can
     only hold one entry too long, never release one too early. */
  for (const chatId of custody.chatIds) {
    if (name === chatId || name.startsWith(`${chatId}-`)) return true;
  }
  return false;
}

async function entries(directory: string) {
  return readdir(directory).catch((error) => {
    if (isErrnoCode(error, "ENOENT")) return [] as string[];
    throw error;
  });
}

async function readJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return null;
    throw error;
  }
}
