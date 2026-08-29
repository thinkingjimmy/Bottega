/**
 * [INPUT]: Depends on the shared Project Personalization bridge contract exposed by preload
 * [OUTPUT]: Provides bridge presence, list/save/reveal wrappers for Project instruction files
 * [POS]: Renderer boundary for Project Personalization; browser fallback remains explicit to the view
 */

import type {
  ProjectInstructionsFileId,
  ProjectPersonalizationBridgeApi,
  SaveProjectInstructionsInput,
} from "../../shared/personalization-ipc";

declare global {
  interface Window {
    projectPersonalization?: ProjectPersonalizationBridgeApi;
  }
}

export const hasProjectPersonalizationBridge = () =>
  Boolean(window.projectPersonalization);

const bridge = () => {
  if (!window.projectPersonalization) {
    throw new Error("PROJECT_PERSONALIZATION_BRIDGE_MISSING");
  }
  return window.projectPersonalization;
};

export const listProjectInstructions = (projectId: string) =>
  bridge().list(projectId);
export const saveProjectInstructions = (input: SaveProjectInstructionsInput) =>
  bridge().save(input);
export const revealProjectInstructions = (
  projectId: string,
  fileId: ProjectInstructionsFileId
) => bridge().reveal(projectId, fileId);
