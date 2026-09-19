/**
 * [INPUT]: Depends only on the closed Chat/Project owner identity contract.
 * [OUTPUT]: Provides BaseOwner, BaseOwnerKey, BaseOwnerRef, ownerKeyOf, ownerFromKey and BASE_OWNER_KEY_PATTERN.
 * [POS]: Dependency-free Base identity boundary shared by renderer, main and IPC consumers.
 */
export const BASE_OWNER_KEY_PATTERN = /^(?:chat|project):[A-Za-z0-9_-]{1,128}$/;

export type BaseOwner =
  | { kind: "chat"; chatId: string; incarnationId: string }
  | { kind: "project"; projectId: string };
export type BaseOwnerKey = `chat:${string}` | `project:${string}`;
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
