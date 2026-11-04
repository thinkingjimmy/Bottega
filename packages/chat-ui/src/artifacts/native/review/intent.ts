/**
 * [INPUT]: Validated native comments, frozen draft input and one stable pending save identity.
 * [OUTPUT]: commentIntent reconstructs the exact desired thread/message bytes without a second comment store.
 * [POS]: Native review intent projection; source and journal remain authoritative.
 */
import { nativeCommentsSchema, type NativeComments, type NativeInput, type NativeCommentSave } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
export async function commentDigest(value: NativeComments) {
  const bytes = new TextEncoder().encode(JSON.stringify(nativeCommentsSchema.parse(value)));
  return "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export function commentIntent(document: NativeComments, input: NativeInput, intent: Pick<NativeCommentSave, "kind" | "threadId" | "requestId" | "at">): NativeComments | undefined {
  const { kind, threadId, at, requestId } = intent, existing = document.threads.find(thread => thread.id === threadId);
  if (kind === "create") {
    const draft = input.compose; if (!draft?.text.trim()) return;
    if (existing) return nativeCommentsSchema.parse({ version: 1, threads: document.threads.map(thread => thread.id === threadId ? { ...thread, updatedAt: at,
      messages: thread.messages.map((message, index) => index === 0 ? { ...message, text: draft.text.trim(), editedAt: at } : message) } : thread) });
    return nativeCommentsSchema.parse({ version: 1, threads: [...document.threads, { id: threadId, anchor: draft.anchor, label: draft.label,
      ...(draft.detail ? { detail: draft.detail } : {}), location: { ...(draft.file ? { file: draft.file, revision: draft.revision, readSetDigest: draft.readSetDigest, snapshotRef: draft.snapshotRef } : {}),
        ...(draft.area ? { area: true } : {}), ...(draft.section ? { section: draft.section } : {}) }, status: "open", createdAt: at, updatedAt: at,
      messages: [{ id: "m_" + draft.requestId, author: { kind: "user", name: "You" }, text: draft.text.trim(), at }] }] });
  }
  if (!existing) return;
  if (kind === "delete") return nativeCommentsSchema.parse({ version: 1, threads: document.threads.filter(thread => thread.id !== threadId) });
  if (kind === "edit") {
    if (input.edit?.threadId !== threadId || !input.edit.text.trim() || !existing.messages.length) return;
    return nativeCommentsSchema.parse({ version: 1, threads: document.threads.map(thread => thread.id === threadId ? { ...thread, updatedAt: at,
      messages: thread.messages.map((message, index) => index === 0 ? { ...message, text: input.edit!.text.trim(), editedAt: at } : message) } : thread) });
  }
  if (kind === "reply") {
    const reply = input.reply; if (reply?.threadId !== threadId || !reply.text.trim()) return;
    if (existing.messages.some(message => message.id === "m_" + requestId)) return document;
    return nativeCommentsSchema.parse({ version: 1, threads: document.threads.map(thread => thread.id === threadId ? { ...thread, status: "open", updatedAt: at, resolvedAt: undefined,
      messages: [...thread.messages, { id: "m_" + requestId, author: { kind: "user", name: "You" }, text: reply.text.trim(), at }] } : thread) });
  }
  return nativeCommentsSchema.parse({ version: 1, threads: document.threads.map(thread => thread.id === threadId ? { ...thread, status: kind === "resolve" ? "resolved" : "open",
    updatedAt: at, resolvedAt: kind === "resolve" ? at : undefined } : thread) });
}
