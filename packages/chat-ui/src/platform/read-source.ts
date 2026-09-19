/**
 * [INPUT]: Depends on bounded public Chat query contracts, verified body readers and injected file lifetimes.
 * [OUTPUT]: Request-bound authenticated Chat/import reads with admitted-head reuse, wide native body decoding, bounded import decoding and verified import source Agent; search remains client-owned.
 * [POS]: Transport-neutral read adapter; desktop may override it with its confirmed SQLite cache.
 */
import { cloudFunctions, type BlobDescriptor, type CloudFunctionArgs, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { z } from "zod";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { importStatusSchema, importedEntrySchema } from "@ai-chat/cloud-protocol/chats/imported/model";
import { openImportStatus, openImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/encrypted/client";
import type { EncryptedMessageBlock } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { prepareMessageBlockReader, type MessageBlocksQuery } from "@ai-chat/cloud-protocol/chats/encrypted/messages/batch";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { readInParallel } from "./transcript/parallel";
import { openChatHead, openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { readChatBody } from "@ai-chat/cloud-protocol/chats/transcript/reader";
import { liveTurnStateSchema } from "@ai-chat/cloud-protocol/turns/model";
import { turnChunkSchema } from "@ai-chat/cloud-protocol/turns/live";
import { openTurnChunk } from "@ai-chat/cloud-protocol/turns/encrypted/client";
import { cipherTurnIdentity } from "@ai-chat/cloud-protocol/turns/encrypted/wire";
import { openLiveTurnState, type TurnReceiptReader } from "@ai-chat/cloud-protocol/turns/encrypted/receipt";
import type { TurnPrefixReader } from "@ai-chat/cloud-protocol/turns/encrypted/prefix";
import type { ChatListSource, TranscriptSource } from "./contracts";
import { transcriptRequestSchema, transcriptPageSchema } from "./model";
export type ChatQueryName = "chats/metadata:head" | "chats/metadata:catalog" | "chats/metadata:page" | "chats/catalog:page" |
  "chats/body/reads:head" | "chats/body/reads:page" | "chats/body/reads:get" | "chats/body/reads:block" | "chats/body/reads:blocks" |
  "chats/imported/reads:head" | "chats/imported/reads:page" | "turns/reads:state" | "turns/reads:page";
export type ChatQueryInput<N extends ChatQueryName> = Omit<CloudFunctionArgs<N>, "environmentId" | "deploymentId" | "protocolVersion" | "expectedUserId" | "encryptedSpace">;
/** One block read costs one round trip, so a 50-message page is dominated by how many bodies decode at once. */
const NATIVE_BODY_WIDTH = 12;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const decodedLiveState = liveTurnStateSchema.extend({ ciphertextIdentityHash: digest, lastCiphertextHash: digest });
const decodedChunk = z.object({ ...turnChunkSchema.shape, ciphertextHash: digest, previousCiphertextHash: digest }).strict();
const decodedReadSchemas = {
  "turns/reads:state": decodedLiveState.nullable(),
  "turns/reads:page": z.object({ state: decodedLiveState.nullable(), chunks: z.array(decodedChunk).max(3), complete: z.boolean() }).strict(),
  "chats/imported/reads:head": importStatusSchema.nullable(),
  "chats/imported/reads:page": cloudFunctions["chats/imported/reads:page"].result.extend({ entries: z.array(importedEntrySchema).max(50) }),
  "chats/metadata:head": cloudChatHeadSchema.nullable(),
  "chats/metadata:page": cloudFunctions["chats/metadata:page"].result.extend({ items: z.array(cloudChatHeadSchema).max(30) }),
  "chats/catalog:page": cloudFunctions["chats/catalog:page"].result.extend({ items: z.array(cloudChatHeadSchema).max(30) }),
};
export type ChatQueryResult<N extends ChatQueryName> = N extends keyof typeof decodedReadSchemas ? z.infer<(typeof decodedReadSchemas)[N]> : CloudFunctionResult<N>;
export function parseChatReadResult<N extends ChatQueryName>(name: N, value: unknown): ChatQueryResult<N> {
  const schema = decodedReadSchemas[name as keyof typeof decodedReadSchemas] ?? cloudFunctions[name].result;
  return schema.parse(value) as ChatQueryResult<N>;
}
export async function openChatReadResult<N extends ChatQueryName>(name: N, raw: unknown, crypto: FileCipherPort, signal: AbortSignal, options?: { input: ChatQueryInput<N>;
  readBlocks?(chatId: string, blocks: Parameters<MessageBlocksQuery>[0], signal: AbortSignal): ReturnType<MessageBlocksQuery>;
  readBlock(chatId: string, bodyHash: string, blockId: string, signal: AbortSignal): Promise<EncryptedMessageBlock>; turnReader?: TurnReceiptReader }): Promise<ChatQueryResult<N>> {
  let value: unknown = cloudFunctions[name].result.parse(raw);
  if (name === "chats/metadata:head" && value) {
    if (!options) throw new Error("CHAT_REQUEST_IDENTITY_REQUIRED");
    value = await openChatHeadForRequest(value as NonNullable<CloudFunctionResult<"chats/metadata:head">>,
      (options.input as ChatQueryInput<"chats/metadata:head">).chatId, crypto, signal);
  }
  if (name === "chats/metadata:page" || name === "chats/catalog:page") {
    const page = value as CloudFunctionResult<"chats/catalog:page">, items = [];
    for (const head of page.items) items.push(await openChatHead(head, crypto, signal));
    value = { ...page, items };
  }
  if (name === "chats/imported/reads:head" && value) {
    const head = value as NonNullable<CloudFunctionResult<"chats/imported/reads:head">>;
    if (!options || head.manifest.chatId !== (options.input as ChatQueryInput<"chats/imported/reads:head">).chatId) throw new Error("IMPORT_MEMBERSHIP_CHANGED");
    value = await openImportStatus(head, crypto, signal);
  }
  if (name === "chats/imported/reads:page") {
    if (!options) throw new Error("IMPORT_BLOCK_READER_REQUIRED");
    const page = value as CloudFunctionResult<"chats/imported/reads:page">, input = options.input as ChatQueryInput<"chats/imported/reads:page">;
    const blocks = options.readBlocks ? await prepareMessageBlockReader(page.entries, (blocks, current) => options.readBlocks!(input.chatId, blocks, current), signal) : null;
    const entries = await readInParallel(page.entries, signal, async message => {
      if (message.membership.chatId !== input.chatId || message.membership.generationId !== input.generationId) throw new Error("IMPORT_MEMBERSHIP_CHANGED");
      return openImportedEntry(message, crypto, (blockId, current) => blocks ? blocks(message.bodyHash, blockId) : options.readBlock(input.chatId, message.bodyHash, blockId, current), signal);
    }, NATIVE_BODY_WIDTH);
    value = { ...page, entries };
  }
  if (name === "turns/reads:state" || name === "turns/reads:page") {
    if (!options?.turnReader) throw new Error("TURN_READER_REQUIRED");
    const input = options.input as ChatQueryInput<"turns/reads:page">;
    const page = name === "turns/reads:page" ? value as CloudFunctionResult<"turns/reads:page"> : null;
    const state = page ? page.state : value as CloudFunctionResult<"turns/reads:state">;
    if (state && (state.receipt.chatId !== input.chatId || state.receipt.turnId !== input.turnId)) throw new Error("TURN_MEMBERSHIP_CHANGED");
    const opened = state ? { ...await openLiveTurnState(state, crypto, options.turnReader, signal),
      ciphertextIdentityHash: state.receipt.identityHash, lastCiphertextHash: state.lastCiphertextHash } : null;
    if (!page) value = opened;
    else {
      const chunks = []; let sequence = input.afterSeq, previous: string | null = sequence === 0 && state ? state.receipt.identityHash : null;
      for (const packet of page.chunks) {
        if (!state || packet.seq !== sequence + 1 || packet.seq > input.throughSeq || previous !== null && packet.previousCiphertextHash !== previous) throw new Error("TURN_CHUNK_CHAIN_CHANGED");
        const chunk = await openTurnChunk(packet, cipherTurnIdentity(state.receipt.start), crypto, signal);
        chunks.push({ ...chunk, ciphertextHash: packet.packet.ciphertextHash, previousCiphertextHash: packet.previousCiphertextHash });
        sequence = packet.seq; previous = packet.packet.ciphertextHash;
      }
      value = { ...page, state: opened, chunks };
    }
  }
  signal.throwIfAborted(); return parseChatReadResult(name, value);
}
export interface ChatReadTransport {
  query<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>, signal: AbortSignal): Promise<ChatQueryResult<N>>;
  watch<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>, changed: (value: ChatQueryResult<N>) => void, failed: (error: unknown) => void): () => void;
  rawPrefixPage?: TurnPrefixReader;
}
export function cloudReadSources(ports: { transport: ChatReadTransport; crypto(): FileCipherPort;
  preview(chatId: string, descriptor: BlobDescriptor, signal: AbortSignal): Promise<{ url: string; release(): void }> }): { chats: ChatListSource; transcript: TranscriptSource } {
  const { transport } = ports;
  const chats: ChatListSource = {
    browse: (input, signal) => transport.query("chats/catalog:page", input, signal),
    async page(input, signal) {
      const revision = input.throughRevision ?? (await transport.query("chats/metadata:catalog", {}, signal)).revision;
      const page = await transport.query("chats/metadata:page", { afterRevision: input.afterRevision, throughRevision: revision }, signal);
      return { ...page, revision };
    },
    head: (chatId, signal) => transport.query("chats/metadata:head", { chatId }, signal),
    subscribe: (changed, failed) => transport.watch("chats/metadata:catalog", {}, value => changed(value.revision), failed),
  };
  const transcript: TranscriptSource = {
    async locate(chatId, messageId, signal) {
      const message = await transport.query("chats/body/reads:get", { chatId, messageId }, signal);
      return message ? { segment: "native", seq: message.summary.seq } : null;
    },
    async page(raw, signal, confirmedHead) {
      const input = transcriptRequestSchema.parse(raw);
      if (confirmedHead && confirmedHead.chat.id !== input.chatId) throw new Error("CHAT_IDENTITY_CHANGED");
      const headRead = confirmedHead ? Promise.resolve(confirmedHead) : chats.head(input.chatId, signal);
      const segmentRead = input.segment === "imported" ? transport.query("chats/imported/reads:head", { chatId: input.chatId }, signal)
        : transport.query("chats/body/reads:head", { chatId: input.chatId }, signal);
      const [head, segmentHead] = await Promise.all([headRead, segmentRead]);
      signal.throwIfAborted(); if (!head) throw new Error("CHAT_UNAVAILABLE");
      if (input.segment === "imported") {
        const imported = segmentHead as ChatQueryResult<"chats/imported/reads:head">;
        if (imported && imported.manifest.incarnationId !== head.chat.incarnationId) throw new Error("IMPORT_GENERATION_CHANGED");
        const base = { chatId: input.chatId, incarnationId: head.chat.incarnationId, segment: input.segment, messages: [],
          importedBackend: imported?.manifest.sourceKind, revision: imported?.revision ?? 0, generationId: imported?.manifest.generationId ?? null };
        if (!imported) return transcriptPageSchema.parse({ ...base, state: "ready", imported: [], cursor: null, complete: true });
        if (input.generationId !== null && (input.generationId !== imported.manifest.generationId || input.revision !== imported.revision)) throw new Error("IMPORT_GENERATION_CHANGED");
        if (imported.state !== "ready") return transcriptPageSchema.parse({ ...base, state: "pending", imported: [], cursor: null, complete: false });
        const page = await transport.query("chats/imported/reads:page", { chatId: input.chatId, generationId: imported.manifest.generationId,
          revision: imported.revision, beforeSeq: input.beforeSeq, limit: input.limit }, signal);
        return transcriptPageSchema.parse({ ...base, state: imported.manifest.incompleteTail ? "partial" : "ready", imported: page.entries, cursor: page.next, complete: page.complete });
      }
      const native = segmentHead as ChatQueryResult<"chats/body/reads:head">;
      if (input.revision !== null && input.revision !== native.bodyRevision || native.incarnationId !== head.chat.incarnationId) throw new Error("CHAT_BODY_CHANGED");
      const base = { chatId: input.chatId, incarnationId: native.incarnationId, segment: input.segment, revision: native.bodyRevision, generationId: null, imported: [] };
      if (native.state !== "ready") return transcriptPageSchema.parse({ ...base, state: "pending", messages: [], cursor: null, complete: false });
      if (native.headSeq === 0) return transcriptPageSchema.parse({ ...base, state: "ready", messages: [], cursor: null, complete: true });
      const page = await transport.query("chats/body/reads:page", { chatId: input.chatId, incarnationId: native.incarnationId,
        throughRevision: native.bodyRevision, beforeSeq: input.beforeSeq, afterSeq: 0, limit: input.limit }, signal);
      const blocks = await prepareMessageBlockReader(page.items.flatMap(item => item.storage.kind === "encrypted" ? [item.storage.message] : []),
        (blocks, current) => transport.query("chats/body/reads:blocks", { chatId: input.chatId, blocks }, current), signal);
      const bodies = await readInParallel(page.items, signal, item => readChatBody(item, head.chat, { crypto: ports.crypto,
          readBlock: (_chatId, bodyHash, blockId) => blocks(bodyHash, blockId),
          readPrefixPage: (...args) => { if (!transport.rawPrefixPage) throw new Error("TURN_PREFIX_READER_REQUIRED"); return transport.rawPrefixPage(...args); } }, signal), NATIVE_BODY_WIDTH);
      const messages = bodies.filter(body => body !== null);
      return transcriptPageSchema.parse({ ...base, state: "ready", messages, cursor: page.cursor, complete: page.complete });
    },
    subscribe: (chatId, changed, failed) => transport.watch("chats/metadata:head", { chatId }, changed, failed),
    file: ports.preview,
  };
  return { chats, transcript };
}
