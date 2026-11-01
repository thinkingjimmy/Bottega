/**
 * [INPUT]: Authenticated original native frame event, acquisition-bound source identity, exact lease and current Artifact host.
 * [OUTPUT]: NativeDownloadLease fixes the acquired source; saveNativeDownload asks the original main owner to save retained bytes and returns the actual dialog outcome.
 * [POS]: Shared native editor/candidate download message consumer; export bytes never enter workspace commands.
 */
import { artifactFenceSchema } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ArtifactHost, ArtifactLease } from "../context";
export type NativeDownloadLease = ArtifactLease & { nativeToken: string; artifactId: string };
export async function saveNativeDownload(host: ArtifactHost, lease: NativeDownloadLease, event: MessageEvent) {
  if (!event.isTrusted || event.source == null || event.origin !== lease.origin || event.data?.token !== lease.nativeToken || event.data.type !== "bottega:native:download") return;
  const fence = artifactFenceSchema.safeParse(event.data.delivery?.fence), requestId = event.data.requestId;
  if (!fence.success || !fence.data.sha256 || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId)) return;
  let outcome = "failed";
  try {
    const result = await host.workspace!({ action: "native-download", artifactId: lease.artifactId, nonce: lease.id, requestId, exportId: fence.data.id, sourceDigest: "sha256:" + fence.data.sha256 }) as { canceled: boolean };
    outcome = result.canceled ? "declined" : "saved";
  } finally {
    (event.source as Window).postMessage({ type: "bottega:native:download-result", token: lease.nativeToken, requestId, outcome }, lease.origin === "null" ? "*" : lease.origin);
  }
}
