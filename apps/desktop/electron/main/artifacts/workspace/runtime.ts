/**
 * [INPUT]: Initialized document owner, Artifact custody and the single plugin catalog state.
 * [OUTPUT]: One ArtifactWorkspace runtime and original-Chat candidate model selection and completed-source notifications and complete disable/checkpoint/revocation sequence.
 * [POS]: Workspace lifecycle composition; retained data services stay available while disabled.
 */
import { designDocuments } from "../../design/documents/runtime";
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import { ArtifactWorkspace } from "./service";
import { artifactEnabled, artifactGeneration, setArtifactClosing } from "../admission/state";
import { artifactRuntime } from "../core/runtime";
let current: ArtifactWorkspace | undefined;
let releaseSource: (() => void) | undefined;
export function artifactWorkspace() { if (!current) throw new Error("Artifact workspace is not initialized"); return current; }
export function releaseArtifactWindow(windowId: number) { current?.candidates.stop(windowId); current?.checkpoints.release(windowId); }
export async function initializeArtifactWorkspace(root: string, optionsFor?: (chatId: string, incarnationId: string) => ChatTurnOptions) { current = new ArtifactWorkspace(root, optionsFor); await current.initialize();
  const owner = current; releaseSource?.(); releaseSource = designDocuments().subscribe(revision => owner.checkpoints.sourceChanged(revision, artifactGeneration()));
  artifactRuntime()?.configureDesignRetention((chatId, incarnationId) => owner.checkpoints.releaseChat(chatId, incarnationId)); }
export async function prepareArtifactDisable() {
  setArtifactClosing(true); current?.candidates.stop();
  try { await current?.checkpoints.prepareDisable(artifactGeneration()); }
  catch (error) { setArtifactClosing(false); throw error; }
}
export function finishArtifactToggle() {
  setArtifactClosing(false);
  if (!artifactEnabled()) artifactRuntime()?.gateway.revokeAll();
  current?.checkpoints.changed(artifactGeneration(), artifactEnabled());
}
export async function closeArtifactWorkspace() { releaseSource?.(); releaseSource = undefined; const owner = current; current = undefined; await owner?.candidates.close(); await owner?.checkpoints.close(); }
