/**
 * [INPUT]: Pending executor selection, admitted crypto, canonical downlink and the verified private byte cache.
 * [OUTPUT]: Prefetches transcript and prior Home bytes without creating or writing an execution Home.
 * [POS]: Account-owned preparation optimization; the final handoff still restores a complete current snapshot.
 */
import { DesktopChatDownlink } from "../sync/downlink/chats";
import { readHomeManifest } from "../sync-home/restore/manifest";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { DesktopBlobStore } from "../files/store";
type Ports = Omit<ConstructorParameters<typeof DesktopChatDownlink>[0], "files"> & { userId: string; deviceId: string; files: DesktopBlobStore };
export async function prewarmExecution(head: CloudChatHead, input: Ports, signal: AbortSignal) {
  input.current(); signal.throwIfAborted();
  const downlink = new DesktopChatDownlink({ ...input, files: input.files.transfer, cache: input.files, skipReceipts: true });
  const stop = () => { void downlink.close(); }; signal.addEventListener("abort", stop, { once: true });
  try {
    await downlink.hydrate(head); input.current(); signal.throwIfAborted();
    const snapshot = await readHomeManifest(input, head, signal);
    for (const descriptor of snapshot?.descriptors.values() ?? []) {
      input.current(); signal.throwIfAborted();
      await input.files.read(descriptor, { kind: "chat", id: head.chat.id }, signal);
    }
  } finally { signal.removeEventListener("abort", stop); await downlink.close(); }
}
