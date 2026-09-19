/**
 * [INPUT]: Logical message, subagent and attachment identifiers from the current transcript window.
 * [OUTPUT]: Collision-free image identities and fail-closed current-window source resolution.
 * [POS]: The side panel's image identity codec; durable slots never grant access to absent media.
 */
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
export type ImageIdentity = { kind: "attachment"; attachmentId: string } | { kind: "generated"; messageId: string; subagentId: string | null; itemId: string };
export type ImageRegion = `image:attachment:${string}` | `image:generated:${string}`;
export function encodeImageIdentity(identity: ImageIdentity): ImageRegion {
  if (identity.kind === "attachment") return `image:attachment:${encodeURIComponent(identity.attachmentId)}`;
  if (!identity.messageId || !identity.itemId || identity.subagentId === "") throw new Error("invalid-image-identity");
  return `image:generated:${encodeURIComponent(identity.messageId)}:${identity.subagentId === null ? "" : encodeURIComponent(identity.subagentId)}:${encodeURIComponent(identity.itemId)}`;
}
export function decodeImageIdentity(region: string): ImageIdentity | null {
  try {
    const parts = region.split(":");
    if (parts[0] !== "image") return null;
    if (parts[1] === "attachment" && parts.length === 3) {
      const attachmentId = decodeURIComponent(parts[2]!);
      return /^[A-Za-z0-9_-]{10,64}$/.test(attachmentId) ? { kind: "attachment", attachmentId } : null;
    }
    if (parts[1] === "generated" && parts.length === 4 && /^(0|[1-9][0-9]*)$/.test(parts[2]!)) {
      const seq = Number(parts[2]), itemId = decodeURIComponent(parts[3]!);
      return Number.isSafeInteger(seq) && itemId && itemId.length <= 256 ? { kind: "generated", messageId: `seq:${seq}`, subagentId: null, itemId } : null;
    }
    if (parts[1] !== "generated" || parts.length !== 5) return null;
    const [messageId, subagentId, itemId] = parts.slice(2).map(decodeURIComponent);
    return messageId && itemId && messageId.length <= 128 && itemId.length <= 256 && subagentId!.length <= 256
      ? { kind: "generated", messageId, subagentId: subagentId || null, itemId } : null;
  } catch { return null; }
}
export function resolveImage(identity: ImageIdentity, bodies: readonly ChatBody[], fallback: string) {
  for (const body of bodies) {
    if (body.message.segment === "imported") continue;
    if (identity.kind === "attachment") {
      const file = body.attachments.find(item => item.attachmentId === identity.attachmentId);
      if (file && file.blob.mime.startsWith("image/")) return { blob: file.blob, label: body.message.role === "user" ? body.message.attachments?.find(item => item.id === identity.attachmentId)?.filename ?? fallback : fallback };
    } else if (body.message.id === identity.messageId || `seq:${body.message.seq}` === identity.messageId) {
      const media = body.media.find(item => item.subagentId === identity.subagentId && item.itemId === identity.itemId);
      const parts = identity.subagentId === null ? body.message.role === "assistant" ? body.message.parts : [] : body.subagents?.[identity.subagentId]?.parts;
      const part = parts?.find(item => item.type === "tool" && item.itemId === identity.itemId && item.tool === "image" && item.status === "completed");
      if (media && part?.type === "tool") return { blob: media.blob, label: part.title || fallback };
    }
  }
  return null;
}
