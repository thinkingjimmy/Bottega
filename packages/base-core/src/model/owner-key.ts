/**
 * [INPUT]: Depends on the owner-key grammar of @bottega/contracts (core/owner-key); the dependency runs one way, base-core to contracts.
 * [OUTPUT]: Provides BaseOwner, BaseOwnerKey, BaseOwnerRef, ownerKeyOf, ownerFromKey and BASE_OWNER_KEY_PATTERN.
 * [POS]: Base identity boundary shared by renderer, main and IPC consumers; the key grammar itself is a public contract.
 */
import { BASE_OWNER_KEY_PATTERN, type BaseOwnerKey } from "@bottega/contracts/core/owner-key";

export { BASE_OWNER_KEY_PATTERN, type BaseOwnerKey };

export type BaseOwner =
  | { kind: "chat"; chatId: string; incarnationId: string }
  | { kind: "project"; projectId: string };
export type BaseOwnerRef =
  | { kind: "chat"; chatId: string }
  | { kind: "project"; projectId: string };

export function ownerKeyOf(owner: BaseOwner): BaseOwnerKey {
  return owner.kind === "chat"
    ? `chat:${owner.chatId}`
    : `project:${owner.projectId}`;
}

export function ownerFromKey(ownerKey: string): BaseOwnerRef {
  const match = /^(chat|project):([A-Za-z0-9_-]{1,128})$/.exec(ownerKey);
  if (!match) throw new Error("Base ownerKey 格式无效");
  return match[1] === "chat"
    ? { kind: "chat", chatId: match[2]! }
    : { kind: "project", projectId: match[2]! };
}
