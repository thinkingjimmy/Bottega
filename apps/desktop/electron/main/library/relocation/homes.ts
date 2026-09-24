/**
 * [INPUT]: Depends on the Chat Home ledger schema and file location, the Home marker file and Node filesystem identity.
 * [OUTPUT]: Provides rebaseChatHomes (moves every recorded Home under `from` to `to`) and managedWorktrees (the verified managed worktrees now under a root).
 * [POS]: Relocation's ledger step, run before ChatHomeLedger is constructed; it is the only writer of the ledger outside that owner.
 */
import { lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chatHomeLedgerSchema, type ChatHomeRecord } from "../../chat-home/ledger-values";
import { isErrnoCode } from "../../persistence/durable-json";
import { isUnder as under } from "../paths";

/* The file name the Home owner writes into every Home it materializes. */
const HOME_MARKER = ".ai-chat-home.json";

const rebase = (path: string, from: string, to: string) => under(path, from) ? to + path.slice(from.length) : path;

async function markerMatches(record: ChatHomeRecord) {
  try {
    const marker = join(record.homeDir, HOME_MARKER);
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const value = JSON.parse(await readFile(marker, "utf8")) as Record<string, unknown>;
    return value.intentId === record.intentId && value.chatId === record.chatId && value.incarnationId === record.incarnationId;
  } catch { return false; }
}

const ledgerPath = (userData: string) => join(userData, "chat-home-ledger.json");

async function readLedger(userData: string) {
  try { return chatHomeLedgerSchema.parse(JSON.parse(await readFile(ledgerPath(userData), "utf8"))); }
  catch (error) { if (isErrnoCode(error, "ENOENT")) return null; throw error; }
}

/**
 * The root identity is the ledger's proof that a Home still sits in the folder it was made in.
 * A cross-volume copy changes it, so it is stamped again from the new root — but only for a
 * Home whose own marker still names this record. Anything else keeps the stale identity and
 * stays fail-closed, exactly as it would have before the move.
 */
export async function rebaseChatHomes(userData: string, from: string, to: string) {
  const ledger = await readLedger(userData);
  if (!ledger) return 0;
  const rootInfo = await stat(to);
  const identity = { dev: String(rootInfo.dev), ino: String(rootInfo.ino) };
  let rebased = 0;
  for (const [chatId, record] of Object.entries(ledger.chats)) {
    if (!under(record.canonicalRoot, from) && !under(record.homeDir, from)) continue;
    const next = { ...record, homeDir: rebase(record.homeDir, from, to), canonicalRoot: rebase(record.canonicalRoot, from, to) };
    if (await markerMatches(next)) next.rootIdentity = identity;
    ledger.chats[chatId] = next;
    rebased++;
  }
  if (!rebased) return 0;
  const temporary = `${ledgerPath(userData)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(chatHomeLedgerSchema.parse(ledger), null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, ledgerPath(userData));
  return rebased;
}

/** Read after the rewrite rather than returned by it, so a launch that resumes past the rewrite still repairs them. */
export async function managedWorktrees(userData: string, root: string) {
  const ledger = await readLedger(userData);
  const worktrees: string[] = [];
  for (const record of Object.values(ledger?.chats ?? {})) {
    if (record.worktree && record.phase === "committed" && under(record.homeDir, root) && await markerMatches(record)) {
      worktrees.push(join(record.homeDir, record.worktree.relativePath));
    }
  }
  return worktrees;
}
