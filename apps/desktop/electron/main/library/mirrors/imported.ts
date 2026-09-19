/**
 * [INPUT]: Depends on immutable source-generation pages, shared message projections and lossless foreign-history fields.
 * [OUTPUT]: Streams portable external transcripts with their authored head receipt, restores original generations and reports unverifiable tails.
 * [POS]: External-history folder boundary; readable v1 messages carry their unabridged source projection as an additive field.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { sourceSchema } from "./imported-codec";
import type { ChatStore } from "../../chats/chat-store";
import { projectForeignParts } from "../../chats/sqlite/import/foreign-projection";
import { projectChatClassification } from "../../../../shared/local-storage/contracts";
import { truncateUtf8 } from "../../../../shared/truncate-utf8";
import { durableReplaceFile, syncDirectory, quarantineDurableFile } from "../../persistence/durable-json";
import { mirrorChatSchema, mirrorHash, encodeTranscript, type MirrorChat, type MirrorTranscript } from "./codec";
import { libraryDirectory } from "../paths";
export async function exportLibraryImport(chats: ChatStore, root: string, chatId: string, provided?: MirrorChat, native?: MirrorTranscript) {
  const metadata = provided ?? chats.getMetadata(chatId); if (!metadata) return;
  const directory = await libraryDirectory(root, "chats", chatId), temporary = join(directory, `.transcript-${randomUUID()}`);
  const output = await open(temporary, "wx", 0o600), hash = createHash("sha256");
  const write = async (value: unknown) => { const line = JSON.stringify(value) + "\n"; hash.update(line); await output.writeFile(line); };
  let generationId: string | null = null, seq = 0;
  try {
    await write({ format: "bottega-transcript", version: 1 });
    for (;;) {
      const page = await chats.library.imported(chatId, generationId, seq); generationId = page.generationId;
      if (!page.message) break;
      const source = sourceSchema.parse(page.message), id = /^[A-Za-z0-9_-]{1,128}$/.test(source.id) ? source.id : mirrorHash(source.id);
      const parts = source.role === "assistant" ? projectForeignParts({ process: source.process, tools: source.tools, budgetBytes: 16 * 1024, itemIdPrefix: id }) : [];
      await write({ id, role: source.role, seq: source.deliverySeq, ...(native ? { segment: "imported" } : {}), content: truncateUtf8(source.content, 8192).value, createdAt: source.createdAt,
        ...(source.role === "assistant" ? { backend: metadata.agent, ...(parts.length ? { parts } : {}) } : {}), importedSource: source });
      seq = source.deliverySeq;
    }
    if (native) for (const line of encodeTranscript(native).split("\n").slice(1).filter(Boolean)) await write(JSON.parse(line));
    await output.sync(); await output.close();
    await rename(temporary, join(directory, "transcript.jsonl")); await syncDirectory(directory);
    const head = mirrorChatSchema.parse({ version: 1, id: metadata.id, incarnationId: metadata.incarnationId, title: metadata.title, agent: metadata.agent,
      options: metadata.options, agentRevision: metadata.agentRevision, classification: "classification" in metadata ? metadata.classification : projectChatClassification(metadata), createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt, sortKey: metadata.sortKey, kind: native ? "external-managed" : "external-readonly", archivedAt: metadata.archivedAt ?? null,
      ...(provided ?? {}), headSeq: native ? native.messages.at(-1)?.seq ?? 0 : seq, transcriptHash: hash.digest("hex"), nativeSessions: provided?.nativeSessions ?? [] });
    await durableReplaceFile(join(directory, "chat.json"), JSON.stringify(head, null, 2) + "\n");
    return head;
  } finally { await output.close().catch(() => {}); await rm(temporary, { force: true }); }
}
/* Resolves true when the copy's tail could not be verified: the verified prefix was imported
   and the original file was quarantined. The caller owns the user-facing report. An
   external-managed copy never reports — SQLite rewrites its tail at the next settlement. */
export async function openLibraryImport(chats: ChatStore, directory: string, head: MirrorChat): Promise<boolean> {
  const existing = chats.getMetadata(head.id);
  if (existing && (existing.incarnationId !== head.incarnationId || existing.readOnlyReason !== "external-readonly" && head.kind !== "external-managed")) throw new Error("LIBRARY_IMPORT_IDENTITY_CHANGED");
  const path = join(directory, "transcript.jsonl"), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("LIBRARY_FILE_INVALID");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  const contentHash = hash.digest("hex"), incomplete = contentHash !== head.transcriptHash;
  const tail = await open(path, "r"); const lastByte = Buffer.alloc(1);
  try { if (info.size) await tail.read(lastByte, 0, 1, info.size - 1); } finally { await tail.close(); }
  async function* messages() {
    const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity }); let first = true, seq = 0, pending: string | undefined;
    const parse = (line: string) => {
      const raw = JSON.parse(line);
      if (first) { first = false; if (raw.format !== "bottega-transcript" || raw.version !== 1) throw new Error("LIBRARY_FORMAT_UNSUPPORTED"); return null; }
      if (head.kind === "external-managed" && !raw.importedSource) return null;
      const source = sourceSchema.parse(raw.importedSource);
      if (source.deliverySeq <= seq) throw new Error("LIBRARY_TRANSCRIPT_ORDER_INVALID"); seq = source.deliverySeq;
      return source;
    };
    try {
      for await (const line of reader) {
        if (pending !== undefined) { const source = parse(pending); if (source) yield [source]; }
        pending = line;
      }
      if (pending !== undefined) {
        try { const source = parse(pending); if (source) yield [source]; }
        catch (error) { if (!(error instanceof SyntaxError) || lastByte[0] === 10 || !seq) throw error; }
      }
    } finally { reader.close(); }
  }
  if (existing) {
    let current = await chats.library.imported(head.id, null, 0), extended = false;
    for await (const [source] of messages()) {
      if (!current.message) { extended = true; continue; }
      if (mirrorHash(source) !== mirrorHash(current.message)) throw new Error("LIBRARY_IMPORT_DIVERGED");
      current = await chats.library.imported(head.id, current.generationId, current.message.deliverySeq);
    }
    if (!extended) return false;
    if (existing.readOnlyReason !== "external-readonly") throw new Error("LIBRARY_IMPORT_DIVERGED");
  }
  const origin = existing?.importOrigin;
  await chats.syncExternalHistory({ restoredIdentity: { chatId: head.id, incarnationId: head.incarnationId }, projectId: existing ? existing.projectId : head.classification.projectId,
    sourceKind: origin?.sourceKind ?? head.agent, storageFingerprint: origin?.storageFingerprint ?? `library_${head.id}`,
    canonicalNativeId: origin?.canonicalNativeId ?? head.id, aliases: origin?.aliases ?? [], resumeAlias: origin?.resumeAlias ?? head.id,
    originalCwd: origin?.originalCwd ?? `library:${head.id}`, title: existing?.title ?? head.title ?? "Chat", archivedAt: existing ? existing.archivedAt : head.archivedAt,
    createdAt: head.createdAt, updatedAt: head.updatedAt,
    historyRevision: contentHash, sourceIncarnation: head.incarnationId, sourceSize: info.size, sourceMtimeNs: "0", incompleteTail: incomplete,
    canResume: false, sourceStatus: "missing" }, messages());
  await chats.markImportSourceStatus(head.id, "missing");
  if (!incomplete || head.kind === "external-managed") return false;
  await quarantineDurableFile(path); return true;
}
