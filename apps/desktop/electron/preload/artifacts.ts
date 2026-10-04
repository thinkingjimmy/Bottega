/**
 * [INPUT]: Closed artifact contracts and the trusted preload invoke port.
 * [OUTPUT]: ID-only ArtifactBridge methods.
 * [POS]: Top-frame artifact preload leaf; no native paths or arbitrary IPC channels.
 */
import { ARTIFACT_IPC } from "../../shared/ipc-channels/apps";
import { type ArtifactBridge } from "../../shared/ipc/apps/artifact-ipc";
export function createArtifactBridge(invoke: (channel: string, input: unknown) => Promise<unknown>): ArtifactBridge {
  return { preview: (ref, action) => invoke(ARTIFACT_IPC.preview, { ref, action }) as ReturnType<ArtifactBridge["preview"]>, lease: ref => invoke(ARTIFACT_IPC.lease, ref) as ReturnType<ArtifactBridge["lease"]>,
    release: id => invoke(ARTIFACT_IPC.release, id) as Promise<void>,
    action: (ref, action) => invoke(ARTIFACT_IPC.action, { ref, action }) as Promise<void>,
    workbook: ref => invoke(ARTIFACT_IPC.workbook, ref) as ReturnType<ArtifactBridge["workbook"]>,
    importBase: (ref, sheet, confirmed) => invoke(ARTIFACT_IPC.importBase, { ref, sheet, confirmed }) as ReturnType<ArtifactBridge["importBase"]> };
}
