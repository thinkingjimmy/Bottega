/**
 * [INPUT]: Depends on complete saved history, incremental transcript IO, actual session prompt proofs, the export receipt ledger and Library/Chat custody owners.
 * [OUTPUT]: Exports settled content, opens unchanged folders from receipts, replaces proven stale exports after a durable revision and preserves genuine divergent copies as ordinary Forks.
 * [POS]: Backup projection owner above SQLite; mirror failures never roll back an acknowledged Chat commit.
 */
import { sessionAssistantHash, sessionBoundary } from "../sessions/boundary";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import { createRecoveredChatRecord, allocateForkTitle } from "../../chats/chat-fork";
import { durableReplaceFile, isErrnoCode, quarantineDurableFile } from "../../persistence/durable-json";
import { SerialQueue } from "../../persistence/serial-queue";
import { libraryChatPath, libraryDirectory } from "../paths";
import type { LibraryService } from "../service";
import { encodeChat, encodeTranscript, materializeMirror, mirrorChatSchema, mirrorHash, transcriptHash, type MirrorChat, type MirrorTranscript } from "./codec";
import { MirrorExportLedger, type MirrorExportEntry } from "./ledger";
import { readTranscript } from "./transcript/reader";
import { exportLibraryImport, openLibraryImport } from "./imported";
import { sameMirrorMessage, sameMirrorEntry } from "./store";
import { copyLibraryAssets, copyLibraryHome } from "../assets/copy";

/** A single aggregate report per opening pass; the per-Chat detail belongs in the log. */
export type MirrorNotice = { kind: "chats-unreadable" | "files-missing"; count: number };
export type MirrorProgress = { phase: "opening" | "saving"; completed: number; total: number; issues: string[] };
/** What an opening pass would have to materialize: copies no receipt and no local record explains. */
export type MirrorPlan = { unknown: string[]; bytes: number };
/** Below this a backfill finishes faster than the notice it would publish. */
const SAVING_THRESHOLD = 5;
const PROGRESS_INTERVAL = 100;

async function readRegular(path: string, maxBytes: number) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error("LIBRARY_FILE_INVALID");
  return readFile(path, "utf8");
}
async function regularFile(path: string) {
  const info = await lstat(path).catch(() => null);
  return info?.isFile() && !info.isSymbolicLink() ? info : null;
}

export class ChatMirrorService {
  private readonly queue = new SerialQueue();
  private readonly exported = new Map<string, number | string>();
  private readonly remote = new Map<string, { head: CloudChatHead; complete: boolean }>();
  private readonly pendingRemote = new Set<string>();
  private readonly unreadable = new Set<string>();
  /** Copies a window-first mount skipped; only reconcileDeferred() may materialize them. */
  private readonly deferred = new Set<string>();
  private readonly listeners = new Set<(value: MirrorProgress) => void>();
  private readonly ledger: MirrorExportLedger;
  private unreadableCount = 0;
  private missingCount = 0;
  private reported = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;
  private readonly detachSettlement: () => void;
  private reconciling = false;
  private closed = false;
  constructor(private input: { library: LibraryService; chats: ChatStore; homes: ChatHomeService;
    progress?(value: MirrorProgress): void; notify?(notice: MirrorNotice): void }) {
    this.ledger = new MirrorExportLedger(input.chats.library.userData);
    this.unsubscribe = input.chats.library.subscribe(() => this.schedule());
    this.detachSettlement = input.chats.sync.onHomeSettlement(turn => this.exportChat(turn.chatId));
  }
  private schedule() {
    if (this.closed || this.reconciling || this.timer || !this.input.library.root) return;
    this.timer = setTimeout(() => { this.timer = null; void this.backfill().catch(error => this.warn("export", error)); }, 250);
    this.timer.unref();
  }
  /* A per-Chat code is a coordinate for the log, not a sentence for the user:
     the aggregate notice at the end of the pass is the only product surface. */
  private warn(chatId: string, error: unknown) {
    console.warn(`[library] ${chatId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  /** A second reader of the same throttled stream; the startup window uses it before any renderer exists. */
  onProgress(listener: (value: MirrorProgress) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private report(value: MirrorProgress) {
    const now = Date.now();
    if (value.completed < value.total && now - this.reported < PROGRESS_INTERVAL) return;
    this.reported = now; this.input.progress?.(value);
    for (const listener of this.listeners) listener(value);
  }
  /* A copy whose tail does not verify opens up to its verified prefix and keeps its original
     bytes aside; the pass counts it with the other copies it could not open in full. */
  private copyIncomplete(chatId: string) {
    this.unreadableCount++; this.warn(chatId, new Error("LIBRARY_COPY_INCOMPLETE"));
  }
  private notice() {
    if (this.unreadableCount) this.input.notify?.({ kind: "chats-unreadable", count: this.unreadableCount });
    if (this.missingCount) this.input.notify?.({ kind: "files-missing", count: this.missingCount });
    this.unreadableCount = 0; this.missingCount = 0;
  }
  private async remember(chatId: string, revision: number | string, head: MirrorChat, detail: { chatMessageRevision?: number } = {}) {
    const directory = libraryChatPath(this.input.library.requireRoot(), chatId);
    const info = await regularFile(join(directory, "transcript.jsonl"));
    if (!info) { this.ledger.forget(chatId); return; }
    this.exported.set(chatId, revision);
    this.ledger.record(chatId, { ...detail, revision, transcriptBytes: info.size,
      transcriptHash: head.transcriptHash, headSeq: head.headSeq, headHash: transcriptHash(JSON.stringify(head, null, 2) + "\n") });
    void this.ledger.settle();
  }
  exportChat(chatId: string) {
    return this.queue.enqueue(async () => {
      if (!this.input.library.root) return;
      const metadata = this.input.chats.getMetadata(chatId);
      if (metadata?.readOnlyReason === "external-readonly" && !this.unreadable.has(chatId)) {
        const head = await exportLibraryImport(this.input.chats, this.input.library.requireRoot(), chatId);
        if (head) await this.remember(chatId, metadata.chatRecordRevision, head, { chatMessageRevision: metadata.chatMessageRevision }); return;
      }
      const record = await this.input.chats.get(chatId);
      if (!record || this.unreadable.has(chatId) || record.readOnlyReason === "external-readonly") return;
      const directory = await libraryDirectory(this.input.library.requireRoot(), "chats", chatId);
      const complete = await this.input.chats.library.transcript(chatId);
      const transcript = encodeTranscript(complete);
      for (const branch of record.supersededBranches ?? []) {
        const branches = await libraryDirectory(this.input.library.requireRoot(), "chats", chatId, "branches");
        // Branch files are named by their own hash, so an existing one already holds these bytes.
        const path = join(branches, `${mirrorHash(branch)}.jsonl`);
        if (await regularFile(path)) continue;
        await durableReplaceFile(path, encodeTranscript({ messages: branch.messages, subagents: record.subagents ?? {} }));
      }
      this.input.library.requireRoot();
      let head = encodeChat({ ...record, ...complete }, transcript);
      const recovery = await this.input.chats.library.sessions.read(chatId);
      if (record.session && recovery?.sent?.sessionId === record.session.id && recovery.sent.backend === record.session.backend &&
        recovery.incarnationId === record.incarnationId && recovery.sent.userMessageId === complete.messages.filter(message => message.role === "user").at(-1)?.id) {
        head.nativeSessions[0]!.sentBoundary = { userTurns: recovery.sent.userTurns, userHashes: recovery.sent.userHashes, assistantHash: sessionAssistantHash(complete.messages) };
      }
      if (!record.session && recovery?.pending && recovery.incarnationId === record.incarnationId) head.nativeSessions = recovery.hints;
      if (head.kind === "external-managed") head = (await exportLibraryImport(this.input.chats, this.input.library.requireRoot(), chatId, head, complete))!;
      else { await durableReplaceFile(join(directory, "transcript.jsonl"), transcript);
        await durableReplaceFile(join(directory, "chat.json"), JSON.stringify(head, null, 2) + "\n"); }
      await this.remember(chatId, record.chatRecordRevision, head, { chatMessageRevision: record.chatMessageRevision });
    });
  }
  async backfill(options: { mirrors?: boolean } = {}) {
    if (!this.input.library.root) return;
    const pending = this.input.chats.list().filter(chat => chat.chatRecordRevision !== this.exported.get(chat.id));
    const total = pending.length < SAVING_THRESHOLD ? 0 : pending.length;
    let completed = 0;
    if (total) this.report({ phase: "saving", completed, total, issues: [] });
    for (const chat of pending) {
      try { await this.exportChat(chat.id); } catch (error) { this.warn(chat.id, error); }
      if (total) this.report({ phase: "saving", completed: ++completed, total, issues: [] });
      await setImmediate();
    }
    if (options.mirrors !== false) await this.backfillMirrors();
    await this.ledger.flush();
    this.notice();
  }
  private async backfillMirrors() {
    let afterId: string | null = null;
    for (;;) {
      const page = await this.input.chats.library.mirrors(afterId, this.knownMirrors());
      const actionable = page.filter(item => item.head && !this.unreadable.has(item.chatId) && this.exported.get(item.chatId) !== item.revision);
      const total = actionable.length < SAVING_THRESHOLD ? 0 : actionable.length;
      let completed = 0;
      if (total) this.report({ phase: "saving", completed, total, issues: [] });
      for (const item of actionable) {
        this.remote.set(item.chatId, { head: item.head!, complete: item.complete });
        try { await this.exportMirror(item.chatId, item.head!, item.complete, item.revision); }
        catch (error) { this.warn(item.chatId, error); }
        if (total) this.report({ phase: "saving", completed: ++completed, total, issues: [] });
        await setImmediate();
      }
      if (page.length < 100) break;
      afterId = page.at(-1)!.chatId;
    }
  }
  /** Revisions this profile has already published; the reader skips their heads entirely. */
  private knownMirrors() {
    const known: Record<string, string> = {};
    for (const [chatId, revision] of this.exported) if (typeof revision === "string") known[chatId] = revision;
    return known;
  }
  private exportMirror(chatId: string, head: CloudChatHead, complete: boolean, revision: string) {
    return this.queue.enqueue(async () => {
      if (this.pendingRemote.has(chatId)) {
        await this.openChat(chatId);
        this.pendingRemote.delete(chatId);
      }
      const directory = await libraryDirectory(this.input.library.requireRoot(), "chats", chatId);
      let portable = mirrorChatSchema.parse({ ...head.chat, version: 1, kind: head.kind, archivedAt: head.archivedAt,
        headSeq: head.headSeq, transcriptHash: transcriptHash(""), nativeSessions: [] });
      if (!complete) {
        // Metadata arrives first. Missing text reports a partial copy;
        // it must never become an invented empty conversation.
        try { await lstat(join(directory, "chat.json")); }
        catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error;
          await durableReplaceFile(join(directory, "chat.json"), JSON.stringify(portable, null, 2) + "\n"); }
        return;
      }
      if (head.kind !== "native") portable = (await exportLibraryImport(this.input.chats, this.input.library.requireRoot(), chatId, portable,
        head.kind === "external-managed" ? await this.input.chats.library.transcript(chatId) : undefined))!;
      else {
        const transcript = encodeTranscript(await this.input.chats.library.transcript(chatId));
        portable.transcriptHash = transcriptHash(transcript);
        await durableReplaceFile(join(directory, "transcript.jsonl"), transcript);
        await durableReplaceFile(join(directory, "chat.json"), JSON.stringify(portable, null, 2) + "\n");
      }
      await this.remember(chatId, revision, portable);
    });
  }
  private async chatDirectories(root: string) {
    const entries = await readdir(await libraryDirectory(root, "chats"), { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
  }
  /* A copy is known when a receipt still describes it or SQLite already holds the Chat; anything
     else has to be read before it exists on this profile. Counting is all this costs: no file is
     parsed, so the answer is cheap enough to precede the decision of when to open the window. */
  async plan(): Promise<MirrorPlan> {
    if (!this.input.library.root) return { unknown: [], bytes: 0 };
    const root = this.input.library.requireRoot();
    await this.ledger.open(root);
    const unknown: string[] = [];
    let bytes = 0;
    for (const chatId of await this.chatDirectories(root)) {
      if (await this.receipt(chatId) || this.input.chats.getMetadata(chatId)) continue;
      unknown.push(chatId);
      bytes += (await regularFile(join(libraryChatPath(root, chatId), "transcript.jsonl")))?.size ?? 0;
    }
    return { unknown, bytes };
  }
  /** Everything a pass decides from: the directories to visit, every receipt, and the cloud heads. */
  private async survey(only?: ReadonlySet<string>) {
    const root = this.input.library.requireRoot();
    await this.ledger.open(root);
    const directories = await this.chatDirectories(root);
    const receipts = new Map<string, MirrorExportEntry>();
    for (const chatId of directories) {
      const saved = await this.receipt(chatId);
      if (saved) receipts.set(chatId, saved);
    }
    const known: Record<string, string> = {};
    for (const [chatId, saved] of receipts) if (typeof saved.revision === "string") known[chatId] = saved.revision;
    this.remote.clear();
    const settled = new Set<string>();
    let afterId: string | null = null;
    for (;;) {
      const page = await this.input.chats.library.mirrors(afterId, known);
      for (const item of page) {
        if (item.head) this.remote.set(item.chatId, { head: item.head, complete: item.complete });
        else settled.add(item.chatId);
      }
      if (page.length < 100) break;
      afterId = page.at(-1)!.chatId;
    }
    return { root, receipts, settled, entries: only ? directories.filter(chatId => only.has(chatId)) : directories };
  }
  private async open(entries: readonly string[], survey: { root: string; receipts: Map<string, MirrorExportEntry>; settled: ReadonlySet<string> }) {
    const issues: string[] = [];
    let completed = 0;
    this.report({ phase: "opening", completed, total: entries.length, issues: [] });
    for (const chatId of entries) {
      const saved = survey.receipts.get(chatId);
      /* An unchanged copy is proven by its receipt: same revision, same bytes on disk.
         Reading and re-encoding it would only reproduce what the folder already holds. */
      if (saved && this.unchanged(chatId, saved, survey.settled)) this.exported.set(chatId, saved.revision);
      else {
        if (this.remote.has(chatId)) this.pendingRemote.add(chatId);
        try { await this.openChat(chatId); this.pendingRemote.delete(chatId); this.unreadable.delete(chatId); }
        catch (error) { await this.recoverChat(chatId, survey.root, error); issues.push(chatId); }
        await setImmediate();
      }
      this.report({ phase: "opening", completed: ++completed, total: entries.length, issues: [...issues] });
    }
  }
  /* `defer: "unknown"` opens only what this profile can already account for. The copies it leaves
     behind are exactly plan()'s unknown set, and reconcileDeferred() is the only way they open. */
  async reconcile(options: { defer?: "unknown" } = {}) {
    if (!this.input.library.root) return;
    this.reconciling = true;
    try {
      const survey = await this.survey();
      this.deferred.clear();
      let entries = survey.entries;
      if (options.defer === "unknown") {
        for (const chatId of entries) if (!survey.receipts.has(chatId) && !this.input.chats.getMetadata(chatId)) this.deferred.add(chatId);
        entries = entries.filter(chatId => !this.deferred.has(chatId));
      }
      await this.open(entries, survey);
    } finally { this.reconciling = false; }
    await this.backfill();
  }
  /**
   * The second half of a deferred mount; the cloud heads are read again because a body may have
   * landed since. Returns how many copies it opened, so a caller can tell whether anything that
   * depends on this profile's Chat identities is worth re-reading.
   */
  async reconcileDeferred() {
    if (this.closed || !this.input.library.root || !this.deferred.size) return 0;
    const only = new Set(this.deferred);
    this.deferred.clear();
    this.reconciling = true;
    let opened = 0;
    try { const survey = await this.survey(only); opened = survey.entries.length; await this.open(survey.entries, survey); }
    finally { this.reconciling = false; }
    await this.backfill();
    return opened;
  }
  private async receipt(chatId: string) {
    const saved = this.ledger.entry(chatId);
    if (!saved) return null;
    try {
      const directory = libraryChatPath(this.input.library.requireRoot(), chatId);
      const [head, transcript] = await Promise.all([regularFile(join(directory, "chat.json")), regularFile(join(directory, "transcript.jsonl"))]);
      return head && transcript?.size === saved.transcriptBytes ? saved : null;
    } catch { return null; }
  }
  private unchanged(chatId: string, saved: MirrorExportEntry, settled: ReadonlySet<string>) {
    if (typeof saved.revision === "string") return settled.has(chatId);
    if (this.remote.has(chatId) || this.unreadable.has(chatId)) return false;
    const metadata = this.input.chats.getMetadata(chatId);
    if (!metadata || metadata.chatRecordRevision !== saved.revision) return false;
    return saved.chatMessageRevision === undefined || saved.chatMessageRevision === metadata.chatMessageRevision;
  }
  private staleExport(head: MirrorChat, headText: string, hash: string) {
    if (this.remote.has(head.id) || this.unreadable.has(head.id)) return false;
    const saved = this.ledger.entry(head.id), metadata = this.input.chats.getMetadata(head.id);
    // A crash may leave the previous export behind after SQLite has replaced a turn.
    // Both files must still be exactly ours; edited copies retain the normal recovery path.
    return saved && typeof saved.revision === "number" && saved.chatMessageRevision !== undefined && metadata &&
      metadata.incarnationId === head.incarnationId && metadata.chatRecordRevision > saved.revision &&
      metadata.chatMessageRevision > saved.chatMessageRevision && saved.transcriptHash === hash &&
      head.transcriptHash === hash && saved.headHash === transcriptHash(headText);
  }
  /* An existing unreadable copy is evidence only while SQLite cannot reproduce it.
     For a Chat this profile owns the folder is derived: keep the bytes aside and rewrite. */
  private async recoverChat(chatId: string, root: string, error: unknown) {
    this.warn(chatId, error);
    if (this.remote.has(chatId)) return; // Retry against the verified cloud body before exporting over a copied folder.
    const metadata = this.input.chats.getMetadata(chatId);
    if (metadata && metadata.readOnlyReason !== "external-readonly") {
      const directory = libraryChatPath(root, chatId);
      await quarantineDurableFile(join(directory, "chat.json"));
      await quarantineDurableFile(join(directory, "transcript.jsonl"));
      this.unreadable.delete(chatId); this.exported.delete(chatId); this.ledger.forget(chatId);
      return;
    }
    if (isErrnoCode(error, "ENOENT")) {
      const files = await readdir(join(root, "chats", chatId));
      if (!files.includes("chat.json") && !files.includes("transcript.jsonl")) return;
    }
    if (!this.unreadable.has(chatId)) this.unreadableCount++;
    this.unreadable.add(chatId);
  }
  private async openChat(chatId: string) {
    const remote = this.remote.get(chatId);
    if (remote && !remote.complete) throw new Error("LIBRARY_REMOTE_BODY_PENDING");
    const directory = libraryChatPath(this.input.library.requireRoot(), chatId);
    const headText = await readRegular(join(directory, "chat.json"), 128 * 1024);
    const head = mirrorChatSchema.parse(JSON.parse(headText));
    if (head.id !== chatId) throw new Error("LIBRARY_CHAT_ID_MISMATCH");
    if (head.kind === "external-readonly") {
      if (!remote && await openLibraryImport(this.input.chats, directory, head)) this.copyIncomplete(chatId);
      else {
        try {
          const branches = await libraryDirectory(this.input.library.requireRoot(), "chats", chatId, "branches");
          await readTranscript(join(directory, "transcript.jsonl"), branches);
        } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
      }
      return;
    }
    let decoded: Awaited<ReturnType<typeof readTranscript>>;
    try { decoded = await readTranscript(join(directory, "transcript.jsonl")); }
    catch (error) { if (remote && isErrnoCode(error, "ENOENT")) return; throw error; }
    if (this.staleExport(head, headText, decoded.hash)) return;
    const transcript = decoded.transcript!;
    if (head.kind === "external-managed" && !remote) await openLibraryImport(this.input.chats, directory, head);
    if (decoded.hash !== head.transcriptHash) {
      // A directory copied while the app is running may contain an older head.
      // The ordered transcript is retained, and metadata gets a content-derived title.
      head.title = transcript.messages.find(message => message.role === "user")?.content.trim().slice(0, 200) || head.title;
      this.warn(chatId, new Error("LIBRARY_COPY_INCOMPLETE"));
    }
    await this.restoreChat(head, transcript, remote?.head);
    if (transcript.incompleteTail) await quarantineDurableFile(join(directory, "transcript.jsonl"));
  }
  private async restoreChat(head: MirrorChat, transcript: MirrorTranscript, remote?: CloudChatHead) {
    const chatId = head.id;
    const metadata = this.input.chats.getMetadata(chatId);
    const restoringManaged = head.kind === "external-managed" && metadata?.readOnlyReason === "external-readonly";
    const local = restoringManaged ? null : await this.input.chats.get(chatId);
    const current = local ? { ...local, ...await this.input.chats.library.transcript(chatId) }
      : remote ? materializeMirror(mirrorChatSchema.parse({ ...remote.chat, version: 1, kind: remote.kind, archivedAt: remote.archivedAt,
        headSeq: remote.headSeq, transcriptHash: transcriptHash(""), nativeSessions: [] }), await this.input.chats.library.transcript(chatId),
        join(libraryChatPath(this.input.library.requireRoot(), chatId), "home")) : null;
    if (current?.incarnationId !== undefined && current.incarnationId !== head.incarnationId) throw new Error("LIBRARY_CHAT_INCARNATION_MISMATCH");
    const homeDir = current?.homeDir ?? await this.input.homes.restoreLibraryHome(chatId, head.incarnationId);
    const incoming = materializeMirror(head, transcript, homeDir);
    if (head.kind === "external-managed" && metadata?.importOrigin) incoming.importOrigin = { ...metadata.importOrigin, sourceStatus: "missing" };
    if (!current) {
      await this.input.chats.library.sessions.remember({ id: chatId, incarnationId: head.incarnationId, headSeq: transcript.messages.at(-1)?.seq ?? 0,
        messageId: transcript.messages.at(-1)?.id ?? null, boundary: sessionBoundary(transcript.messages), hints: head.nativeSessions });
      await this.input.chats.library.install(incoming); return;
    }
    let common = 0;
    while (sameMirrorEntry({ messages: current.messages, subagents: current.subagents ?? {} }, { messages: incoming.messages, subagents: incoming.subagents ?? {} }, common)) common++;
    if (common === incoming.messages.length) return;
    if (!remote && common === current.messages.length) { await this.input.chats.library.install(incoming); return; }
    let first = common;
    while (first > 0 && incoming.messages[first]?.role !== "user") first--;
    const messages = incoming.messages.slice(first);
    if (!messages.some(message => message.role === "user")) throw new Error("LIBRARY_FORK_WITHOUT_USER");
    const digest = mirrorHash([head.id, head.incarnationId, messages]);
    const branches = await libraryDirectory(this.input.library.requireRoot(), "chats", chatId, "branches");
    const branchPath = join(branches, `${digest}.jsonl`);
    if (!await regularFile(branchPath)) await durableReplaceFile(branchPath, encodeTranscript({ messages, subagents: transcript.subagents }));
    const childChatId = `fork_${digest.slice(0, 32)}`;
    const existing = this.input.chats.getMetadata(childChatId);
    const childIncarnationId = digest.slice(32), childHome = await this.input.homes.restoreLibraryHome(childChatId, childIncarnationId);
    let ordinal = 0;
    const child = createRecoveredChatRecord({ source: { ...incoming, projectId: null, messages }, childChatId, childIncarnationId,
      title: existing?.title ?? allocateForkTitle(head.title, this.input.chats.list().map(chat => chat.title)), homeDir: childHome, now: existing?.createdAt ?? Date.now(),
      generateId: () => createHash("sha256").update(`${digest}:${ordinal++}`).digest("hex").slice(0, 32) });
    const root = this.input.library.requireRoot();
    const missing = [...await copyLibraryAssets(root, chatId, child), ...(existing ? [] : await copyLibraryHome(root, chatId, child.id))];
    if (missing.length) { this.missingCount += missing.length; this.warn(child.id, new Error(`LIBRARY_FILES_MISSING: ${missing.join(", ")}`)); }
    const saved = existing ? await this.input.chats.library.transcript(childChatId) : null;
    if (!saved || saved.messages.length < child.messages.length) await this.input.chats.library.install(child);
    else if (child.messages.some((message, index) => !sameMirrorMessage(message, saved.messages[index]!))) throw new Error("LIBRARY_FORK_CHANGED");
  }
  async close() {
    this.closed = true; this.unsubscribe(); this.detachSettlement();
    if (this.timer) clearTimeout(this.timer);
    await this.backfill({ mirrors: false });
    this.queue.close(); await this.queue.flush();
    await this.ledger.flush();
  }
}
