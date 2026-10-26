/**
 * [INPUT]: Depends on exact Artifact references, body fences and the startup-owned retained capture descriptor.
 * [OUTPUT]: Provides retainedArtifactFence only when original bytes have an authenticated hash identity.
 * [POS]: Shared metadata-only selection for local Fork copies and background file hydration; failed/reference-only markers remain readable without file transfers.
 */
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import { artifactRuntime } from "../../artifacts/core/runtime";

export function retainedArtifactFence(fence: ArtifactFence, ref?: ArtifactRef): ArtifactFence | null {
  if (ref && ref.artifactId !== fence.id) throw new Error("ARTIFACT_IDENTITY_CHANGED");
  if (fence.sha256) return fence;
  const retained = ref ? artifactRuntime()?.recovery.read(ref)?.fence : null;
  if (!retained?.sha256) return null;
  if (retained.id !== fence.id) throw new Error("ARTIFACT_IDENTITY_CHANGED");
  return retained;
}
