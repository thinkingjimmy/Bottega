/**
 * [INPUT]: Closed file/workspace contracts, workspace event channel and trusted top-frame invoke/subscription ports.
 * [OUTPUT]: ID-scoped file/workspace methods with closed thumbnail-busy IPC normalization and revocable lifecycle subscriptions without filesystem roots.
 * [POS]: Top-frame artifact preload leaf; no native paths or arbitrary IPC channels.
 */
import { ARTIFACT_IPC } from "../../shared/ipc-channels/apps";
import { type ArtifactBridge } from "../../shared/ipc/apps/artifact-ipc";
export function createArtifactBridge(invoke: (channel: string, input: unknown) => Promise<unknown>, subscribe: ArtifactBridge["onWorkspaceEvent"]): ArtifactBridge {
  return { workspace: async input => {
    try { return await invoke(ARTIFACT_IPC.workspace, input); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (input.action === "thumbnail" && (message === "artifact-thumbnail-busy" || message === `Error invoking remote method '${ARTIFACT_IPC.workspace}': Error: artifact-thumbnail-busy`)) throw new Error("artifact-thumbnail-busy");
      throw cause;
    }
  }, onWorkspaceEvent: subscribe, preview: (ref, action) => invoke(ARTIFACT_IPC.preview, { ref, action }) as ReturnType<ArtifactBridge["preview"]>, lease: ref => invoke(ARTIFACT_IPC.lease, ref) as ReturnType<ArtifactBridge["lease"]>,
    release: id => invoke(ARTIFACT_IPC.release, id) as Promise<void>,
    action: (ref, action) => invoke(ARTIFACT_IPC.action, { ref, action }) as Promise<void>,
    workbook: ref => invoke(ARTIFACT_IPC.workbook, ref) as ReturnType<ArtifactBridge["workbook"]>,
    importBase: (ref, sheet, confirmed) => invoke(ARTIFACT_IPC.importBase, { ref, sheet, confirmed }) as ReturnType<ArtifactBridge["importBase"]> };
}
