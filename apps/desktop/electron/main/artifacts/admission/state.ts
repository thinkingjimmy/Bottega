/**
 * [INPUT]: One initialized plugin catalog, persisted Artifact switch/generation and synchronous closing state.
 * [OUTPUT]: Live enablement/generation facts, closing admission and stable disabled/stale-generation refusals.
 * [POS]: Artifact gate for new captures, views and tools; prepared publication recovers through its original bounded journal.
 */
import { installedPluginCatalog } from "../../plugins/catalog";
import { statusError } from "../../ipc/errors";
export const artifactEnabled = () => installedPluginCatalog()?.artifactEnabled() ?? false;
let closing = false;
export const setArtifactClosing = (value: boolean) => { closing = value; };
export const artifactGeneration = () => installedPluginCatalog()?.artifactGeneration() ?? "unavailable";
export function assertArtifactGeneration(value: string | undefined) {
  assertArtifactAdmission();
  if (value !== artifactGeneration()) throw statusError(403, "ARTIFACT_GENERATION_EXPIRED: Reopen the current workspace");
}
export function assertArtifactAdmission() {
  if (closing || !artifactEnabled()) throw statusError(403, "ARTIFACT_DISABLED: Enable Artifact to start this operation");
}
