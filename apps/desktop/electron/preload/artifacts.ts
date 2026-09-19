/**
 * [INPUT]: Closed artifact contracts and the trusted preload invoke port.
 * [OUTPUT]: ID-only ArtifactBridge methods.
 * [POS]: Top-frame artifact preload leaf; no native paths or arbitrary IPC channels.
 */
import { ARTIFACT_IPC, type ArtifactBridge } from "../../shared/artifact-ipc";
export function createArtifactBridge(invoke: (channel: string, input: unknown) => Promise<unknown>): ArtifactBridge {
  return { lease: ref => invoke(ARTIFACT_IPC.lease, ref) as ReturnType<ArtifactBridge["lease"]>,
    release: id => invoke(ARTIFACT_IPC.release, id) as Promise<void>,
    action: (ref, action) => invoke(ARTIFACT_IPC.action, { ref, action }) as Promise<void>,
    workbook: ref => invoke(ARTIFACT_IPC.workbook, ref) as ReturnType<ArtifactBridge["workbook"]>,
    importBase: (ref, sheet, confirmed) => invoke(ARTIFACT_IPC.importBase, { ref, sheet, confirmed }) as ReturnType<ArtifactBridge["importBase"]> };
}
