/**
 * [INPUT]: Original owner Artifact host, inert native reference and existing session-only Artifact tabs.
 * [OUTPUT]: Reveals an exact mounted target without closing its view; otherwise opens its work with a retained locate intent. Sent changed targets select their exact owner-verified read-only History version.
 * [POS]: Trusted draft/message navigation; stale targets never become new coordinates or write authority.
 */
import type { DesignReference } from "@ai-chat/cloud-protocol/artifacts/design/reference/model";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { nativeChatCopy } from "./chat-copy";
import type { ArtifactHost } from "../../context";
import { isMountedArtifactHead, rememberArtifactTab, rememberArtifactTarget } from "../../presentation/tabs";
import { requestNativeHistory } from "../../history/navigation";
export async function openDesignReference(host: ArtifactHost, reference: DesignReference) {
  if (!host.workspace) throw new Error("Original Artifact is unavailable");
  const read = await host.workspace({ action: "native-locate", artifactId: reference.artifactId, documentId: reference.documentId, reference }) as WorkspaceRead;
  if (!read.fence) throw new Error("Native target is unavailable");
  const mounted = isMountedArtifactHead(host.scope, read.fence);
  rememberArtifactTab(host.scope, read.fence);
  rememberArtifactTarget(host.scope, read.fence, reference);
  if (!mounted) await host.open(read.fence, host.followUp);
}
export async function openSentDesignReference(host: ArtifactHost, reference: DesignReference) {
  try { await openDesignReference(host, reference); return; }
  catch (cause) {
    if (!host.workspace) throw cause;
    const original = await host.workspace({ action: "read", artifactId: reference.artifactId }) as WorkspaceRead;
    if (original.documentId !== reference.documentId || original.revision !== reference.revision || original.readSetDigest !== reference.readSetDigest) throw cause;
    const current = await host.workspace({ action: "native-head", artifactId: reference.artifactId }) as WorkspaceRead;
    if (!current.fence || current.documentId !== reference.documentId) throw cause;
    const mounted = isMountedArtifactHead(host.scope, current.fence);
    rememberArtifactTab(host.scope, current.fence);
    if (!mounted) await host.open(current.fence, host.followUp);
    requestNativeHistory(host.scope, reference.documentId, reference.revision);
  }
}

export const referenceFailureCopy = (locale: string) => nativeChatCopy(locale).referenceFailed;
