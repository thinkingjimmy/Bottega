/**
 * [INPUT]: Depends on scoped retained sources, frozen native codecs and existing attachment/media projection.
 * [OUTPUT]: Reads retained transcripts/files from original frozen heads even after native metadata removal.
 * [POS]: Recovery presentation adapter; SQLite remains the only custody and receipt authority.
 */
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { contentBlobId, hashBlobSource, type BlobDescriptor, type BlobSource, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { classificationSchema, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { recoverySummarySchema, recoveryPageSchema, type RecoveryIdentity } from "../../../../../shared/cloud/recovery";
import { messageSchema, subagentsSchema } from "../../../chats/chat-schema";
import { retainedSourceRefSchema } from "../../../chats/sqlite/cloud/delivery/contracts";
import { readChatSource, type ChatSyncStore, type NativeSnapshot } from "../../sync/chats/sources";
import { projectChatBody, type ChatBodyBytePorts } from "../../sync/chats/bodies";
import { recoveryBytes } from "./bytes";
import { RecoveryAssets } from "./assets";
import type { HomeTarget } from "../../sync-home/restore/files";
const recoveryContentSchema = z.object({ classification: classificationSchema, messages: z.array(messageSchema),
  subagents: subagentsSchema.default({}) }).passthrough();
export class RecoveryContent {
  private readonly assets: RecoveryAssets;
  constructor(private readonly store: ChatSyncStore, private readonly config: CloudBuildConfig, private readonly bytes: Omit<ChatBodyBytePorts, "files">, userData?: string) {
    this.assets = new RecoveryAssets(store, userData);
  }
  async source(scope: SyncScope, input: RecoveryIdentity) {
    const result = await this.store.read(scope, { type: "recovery-archive", chatId: input.chatId, archiveId: input.archiveId });
    if (result.type !== "recovery-archive") throw new Error("RECOVERY_ARCHIVE_UNAVAILABLE");
    const { source, ...archive } = result.value, descriptor = z.record(z.string(), z.unknown()).parse(await readChatSource(this.store, scope, source));
    return { archive: recoverySummarySchema.parse(archive), descriptor };
  }
  async native(scope: SyncScope, input: RecoveryIdentity) {
    const { archive, descriptor } = await this.source(scope, input);
    if (archive.kind !== "turn" && archive.kind !== "execution") throw new Error("RECOVERY_FILE_ARCHIVE");
    const content = recoveryContentSchema.parse(await readChatSource(this.store, scope, retainedSourceRefSchema.parse(descriptor.body)));
    const original = cloudChatHeadSchema.safeParse(content.head);
    const head = original.success ? null : await this.store.read(scope, { type: "chat-metadata", chatId: input.chatId });
    const chat = original.success ? original.data.chat : head?.type === "chat-metadata" ? head.value.head?.chat : null;
    if (!chat || chat.id !== input.chatId) throw new Error("RECOVERY_CHAT_UNAVAILABLE");
    const snapshot: NativeSnapshot = { chat: { ...chat, classification: content.classification }, lifecycleKind: "native", archivedAt: null,
      nextSeq: content.messages.reduce((seq, message) => Math.max(seq, message.seq + 1), 1), lastCommittedUserSeq: null,
      messages: content.messages, subagents: content.subagents, branches: [] };
    return { archive, content, snapshot };
  }
  private async relatedHome(scope: SyncScope, input: RecoveryIdentity) {
    const result = await this.store.read(scope, { type: "recovery-related-home", chatId: input.chatId, archiveId: input.archiveId });
    if (result.type !== "recovery-related-home") throw new Error("RECOVERY_HOME_UNAVAILABLE");
    return result.value ? this.source(scope, { chatId: input.chatId, archiveId: result.value.archiveId }) : null;
  }
  private async homeInfo(scope: SyncScope, input: RecoveryIdentity) {
    try { const home = await this.relatedHome(scope, input); return home ? await this.assets.homeInfo(scope, home) : null; }
    catch (error) {
      if (error instanceof Error && error.message.includes("RECOVERY_HOME_CAPTURE_PENDING")) return { pending: true, files: 0, omitted: 0 };
      return { pending: false, files: 0, omitted: 0, unavailable: true };
    }
  }
  async restoreHome(scope: SyncScope, input: RecoveryIdentity, target: HomeTarget, signal: AbortSignal) {
    const home = await this.relatedHome(scope, input);
    if (home) await this.assets.restoreHome(scope, home, target, signal);
  }
  private project(scope: SyncScope, value: Awaited<ReturnType<RecoveryContent["native"]>>, message: NativeSnapshot["messages"][number], signal: AbortSignal,
    capture?: (descriptor: BlobDescriptor, source: BlobSource) => Promise<void>) {
    return projectChatBody(value.snapshot, message, this.bytes, async source => {
      signal.throwIfAborted(); const original = { bytes: source.bytes, mime: source.mime, sha256: (await hashBlobSource(source, signal)).sha256 };
      const descriptor = { ...original, blobId: contentBlobId(original, scope.userId) };
      await capture?.(descriptor, source); return descriptor;
    }, signal);
  }
  async page(scope: SyncScope, input: RecoveryIdentity & { before: number | null }, signal: AbortSignal) {
    const archive = await this.source(scope, input);
    if (archive.archive.kind === "imported" || archive.archive.kind === "home") return this.assets.page(scope, archive, input.before, signal);
    const value = await this.native(scope, input), end = input.before ?? value.content.messages.length;
    if (end > value.content.messages.length) throw new Error("RECOVERY_CURSOR_INVALID");
    const start = Math.max(0, end - 20), messages = [];
    let cursor = end, bytes = 0;
    for (let index = end - 1; index >= start; index--) {
      const body = await this.project(scope, value, value.content.messages[index]!, signal), size = Buffer.byteLength(JSON.stringify(body));
      if (messages.length && bytes + size > 4 * 1024 * 1024) break;
      messages.unshift(body); bytes += size; cursor = index;
    }
    const ordinary = value.content.classification.conversationKind === "ordinary", home = ordinary ? await this.homeInfo(scope, input) : null;
    return recoveryPageSchema.parse({ archive: value.archive, messages, home, cursor: cursor ? cursor : null, complete: cursor === 0 });
  }
  async file(scope: SyncScope, input: RecoveryIdentity & { messageId: string; descriptor: BlobDescriptor }, signal: AbortSignal) {
    const archive = await this.source(scope, input);
    if (archive.archive.kind === "imported" || archive.archive.kind === "home") return this.assets.file(scope, archive, input, signal);
    const value = await this.native(scope, input), message = value.content.messages.find(message => message.id === input.messageId);
    if (!message) throw new Error("RECOVERY_FILE_UNAVAILABLE"); let captured: BlobSource | null = null;
    await this.project(scope, value, message, signal, async (descriptor, source) => {
      if (hashChatContent(descriptor) !== hashChatContent(input.descriptor)) return;
      captured = await recoveryBytes(source, descriptor, signal);
    });
    if (!captured) throw new Error("RECOVERY_FILE_UNAVAILABLE"); return captured;
  }
}
