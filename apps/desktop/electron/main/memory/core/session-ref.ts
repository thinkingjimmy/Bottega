/**
 * [INPUT]: Depends on node: crypto and ProviderSessionRef shape
 * [OUTPUT]: Provides memorySessionKey and the only derivative of providerSessionRef
 * [POS]: The remote address single point of the main/memory/core; The adapter receives ref and prohibits the automatic access of the session key by writing remote id
 */

import { createHash } from "node:crypto";
import type { ChatRecord } from "../../../../shared/chats-ipc";
import type { ProviderSessionRef } from "./provider";

/** 远端命名的代次前缀：v1 直接用 sessionKey，v2 起一律哈希寻址。 */
const REMOTE_PREFIX = "aicv2";

export function memorySessionKey(
  chat: Pick<ChatRecord, "id" | "incarnationId">
) {
  return `${chat.id}:${chat.incarnationId}`;
}

export function providerSessionRef(input: {
  sessionKey: string;
  workspacePeerId: string;
}): ProviderSessionRef {
  const digest = createHash("sha256")
    .update(input.sessionKey)
    .digest("hex")
    .slice(0, 32);
  return Object.freeze({
    sessionKey: input.sessionKey,
    workspacePeerId: input.workspacePeerId,
    remoteSessionId: `${REMOTE_PREFIX}_${digest}`,
  });
}

export function workspacePeerId(canonicalWorkspace: string) {
  return createHash("sha256").update(canonicalWorkspace).digest("hex");
}
