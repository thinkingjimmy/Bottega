/**
 * [INPUT]: Initialized document owner, Artifact custody and the single plugin catalog state.
 * [OUTPUT]: One ArtifactWorkspace runtime and complete disable/checkpoint/revocation sequence.
 * [POS]: Workspace lifecycle composition; retained data services stay available while disabled.
 */
import { ArtifactWorkspace } from "./service";
import { artifactEnabled, artifactGeneration, setArtifactClosing } from "../admission/state";
import { artifactRuntime } from "../core/runtime";
let current: ArtifactWorkspace | undefined;
export function artifactWorkspace() { if (!current) throw new Error("Artifact workspace is not initialized"); return current; }
export function releaseArtifactWindow(windowId: number) { current?.checkpoints.release(windowId); }
export async function initializeArtifactWorkspace(root: string) { current = new ArtifactWorkspace(root); await current.initialize();
  const owner = current; artifactRuntime()?.configureDesignRetention((chatId, incarnationId) => owner.checkpoints.releaseChat(chatId, incarnationId)); }
export async function prepareArtifactDisable() {
  setArtifactClosing(true);
  try { await current?.checkpoints.prepareDisable(artifactGeneration()); }
  catch (error) { setArtifactClosing(false); throw error; }
}
export function finishArtifactToggle() {
  setArtifactClosing(false);
  if (!artifactEnabled()) artifactRuntime()?.gateway.revokeAll();
  current?.checkpoints.changed(artifactGeneration(), artifactEnabled());
}
export async function closeArtifactWorkspace() { const owner = current; current = undefined; await owner?.checkpoints.close(); }
