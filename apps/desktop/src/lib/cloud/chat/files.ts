/**
 * [INPUT]: Depends on the closed main file-lease bridge and a verified private descriptor.
 * [OUTPUT]: Reads bounded IPC parts into an owned preview URL and always releases the main lease.
 * [POS]: Shared renderer byte adapter for confirmed Chat and retained local branch files.
 */
import type { CloudChatBridge } from "../../../../shared/cloud/chat";
import type { BlobDescriptor } from "@ai-chat/cloud-protocol";
export async function chatFileURL(bridge: Pick<CloudChatBridge, "readFile" | "closeFile">, open: () => Promise<{ leaseId: string }>,
  descriptor: BlobDescriptor, signal: AbortSignal, urls: Set<string>) {
  signal.throwIfAborted(); const { leaseId } = await open();
  try {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let offset = 0; offset < descriptor.bytes; offset += 1024 * 1024) {
      signal.throwIfAborted(); const length = Math.min(1024 * 1024, descriptor.bytes - offset), bytes = await bridge.readFile({ leaseId, offset, length });
      signal.throwIfAborted(); if (bytes.byteLength !== length) throw new Error("CHAT_FILE_CHANGED"); parts.push(new Uint8Array(bytes));
    }
    signal.throwIfAborted(); const url = URL.createObjectURL(new Blob(parts, { type: descriptor.mime })); urls.add(url);
    return { url, release: () => { if (urls.delete(url)) URL.revokeObjectURL(url); } };
  } finally { await bridge.closeFile({ leaseId }); }
}
