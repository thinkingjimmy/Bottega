/**
 * [INPUT]: Depends on node: crypto and ProviderSessionRef shape
 * [OUTPUT]: Provides providerSessionRef and workspacePeerId, the only derivation of remote session addressing
 * [POS]: The remote-addressing single point of main/memory/core; adapters receive only the hashed remoteSessionId, never the raw sessionKey
 */

import { createHash } from "node:crypto";
import type { ProviderSessionRef } from "./provider";

/** 远端命名的代次前缀：v1 直接用 sessionKey，v2 起一律哈希寻址。 */
const REMOTE_PREFIX = "aicv2";

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
