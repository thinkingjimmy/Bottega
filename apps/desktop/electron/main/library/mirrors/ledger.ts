/**
 * [INPUT]: Depends on the folder identity file, durable single-file publication and forward-tolerant Zod parsing.
 * [OUTPUT]: Provides folder-scoped export receipts with actual head/transcript hashes and batched durable writes.
 * [POS]: mirrors/ opening accelerator and stale-export proof; an unreadable ledger uses conservative copy recovery.
 */
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { durableReplaceFile, isErrnoCode, quarantineDurableFile } from "../../persistence/durable-json";

const entrySchema = z.object({
  revision: z.union([z.number(), z.string().max(256)]),
  chatMessageRevision: z.number().int().nonnegative().optional(),
  transcriptHash: z.string().max(128).optional(),
  headHash: z.string().max(128).optional(),
  transcriptBytes: z.number().int().nonnegative(),
  headSeq: z.number().int().nonnegative().optional(),
}).passthrough();
export type MirrorExportEntry = z.infer<typeof entrySchema>;
/* Unknown keys survive a round trip so a newer build's receipts are not destroyed
   by an older one; an entry this build cannot read is simply re-exported. */
const fileSchema = z.object({ chats: z.record(z.string(), z.unknown()) }).passthrough();
const FLUSH_INTERVAL = 2000;

export class MirrorExportLedger {
  private entries = new Map<string, MirrorExportEntry>();
  private unknown = new Map<string, unknown>();
  private path: string | null = null;
  private opened: string | null = null;
  private opening: Promise<void> | null = null;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  private written = 0;
  constructor(private readonly userData: string) {}

  /** Binds the cache to the folder identity; failure leaves it disabled, never fatal. */
  open(root: string) {
    if (this.opened === root) return this.opening ?? Promise.resolve();
    this.opened = root; this.path = null; this.entries.clear(); this.unknown.clear(); this.dirty = false;
    this.opening = this.load(root).catch(() => { this.path = null; this.entries.clear(); this.unknown.clear(); });
    return this.opening;
  }
  private async load(root: string) {
    const identity = z.object({ libraryId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).passthrough()
      .parse(JSON.parse(await readFile(join(root, ".bottega", "library.json"), "utf8")));
    const path = join(this.userData, "library-mirrors", `${identity.libraryId}.json`);
    this.path = path;
    let text: string;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("LIBRARY_LEDGER_INVALID");
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isErrnoCode(error, "ENOENT")) return;
      await quarantineDurableFile(path).catch(() => undefined);
      return;
    }
    let chats: Record<string, unknown>;
    try { chats = fileSchema.parse(JSON.parse(text)).chats; }
    catch { await quarantineDurableFile(path).catch(() => undefined); return; }
    for (const [chatId, value] of Object.entries(chats)) {
      const entry = entrySchema.safeParse(value);
      if (entry.success) this.entries.set(chatId, entry.data); else this.unknown.set(chatId, value);
    }
  }

  entry(chatId: string) { return this.entries.get(chatId); }
  record(chatId: string, entry: MirrorExportEntry) {
    const previous = this.entries.get(chatId);
    if (previous && previous.revision === entry.revision && previous.transcriptBytes === entry.transcriptBytes &&
      previous.chatMessageRevision === entry.chatMessageRevision && previous.transcriptHash === entry.transcriptHash &&
      previous.headHash === entry.headHash) return;
    this.entries.set(chatId, { ...previous, ...entry }); this.unknown.delete(chatId); this.dirty = true;
  }
  forget(chatId: string) {
    if (!this.entries.delete(chatId) && !this.unknown.delete(chatId)) return;
    this.dirty = true;
  }

  /** Bounds fsyncs during long passes; the final state is published by flush(). */
  settle() {
    if (!this.dirty || Date.now() - this.written < FLUSH_INTERVAL) return this.writing;
    return this.flush();
  }
  flush() {
    if (!this.dirty || !this.path) return this.writing;
    const path = this.path;
    this.dirty = false; this.written = Date.now();
    this.writing = this.writing.then(async () => {
      const chats = { ...Object.fromEntries(this.unknown), ...Object.fromEntries(this.entries) };
      try { await durableReplaceFile(path, JSON.stringify({ version: 1, chats })); }
      catch { this.dirty = true; }
    });
    return this.writing;
  }
}
