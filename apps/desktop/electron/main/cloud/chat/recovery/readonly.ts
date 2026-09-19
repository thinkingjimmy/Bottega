/**
 * [INPUT]: Depends on generation-fenced lossless import pages and the original readonly import writer.
 * [OUTPUT]: Preserves a cloud-deleted folder import under one stable, non-executable local identity.
 * [POS]: Readonly deletion recovery; it never creates a Home, native session or execution grant.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ChatStore } from "../../../chats/chat-store";
import { allocateForkTitle } from "../../../chats/chat-fork";
export async function saveReadonlyCopy(chats: ChatStore, chatId: string, key: string, current: () => void) {
  current();
  const source = chats.getMetadata(chatId), childId = `recovered_${key.slice(0, 32)}`, incarnationId = hashChatContent([key, "readonly-incarnation"]).slice(0, 32);
  if (source?.readOnlyReason !== "external-readonly") throw new Error("READONLY_RECOVERY_SOURCE_CHANGED");
  const existing = chats.getMetadata(childId);
  if (existing) {
    if (existing.incarnationId !== incarnationId || existing.readOnlyReason !== "external-readonly") throw new Error("READONLY_RECOVERY_CHILD_CHANGED");
    return childId;
  }
  const first = await chats.library.imported(chatId, null, 0); current();
  if (!first.generationId) throw new Error("READONLY_RECOVERY_GENERATION_UNAVAILABLE");
  async function* messages() {
    let page = first;
    while (page.message) {
      current(); yield [page.message];
      page = await chats.library.imported(chatId, first.generationId, page.message.deliverySeq); current();
    }
  }
  await chats.syncExternalHistory({ restoredIdentity: { chatId: childId, incarnationId }, projectId: null,
    sourceKind: source.agent, storageFingerprint: `library_${childId}`, canonicalNativeId: childId, aliases: [], resumeAlias: childId,
    originalCwd: `library:${childId}`, title: allocateForkTitle(source.title, chats.list().map(chat => chat.title)),
    createdAt: source.createdAt, updatedAt: source.updatedAt, historyRevision: key, sourceIncarnation: incarnationId,
    sourceSize: 0, sourceMtimeNs: "0", incompleteTail: false, canResume: false, sourceStatus: "missing" }, messages());
  current(); return childId;
}
