/**
 * [INPUT]: Depends on the shared WorkspaceFiles bridge contract, renderer locale, shared i18n runtime, and preload window.workspaceFiles
 * [OUTPUT]: Provides searchWorkspaceFiles (fails open to an "unavailable" result), plus resignWorkspaceFile and readWorkspaceFile, which throw explicit errors on failure
 * [POS]: Renderer's sole boundary for Workspace Files IPC; components never read window.workspaceFiles directly
 */

import type {
  WorkspaceFilesBridgeApi,
  WorkspaceFilesSearchInput,
  WorkspaceFilesSearchResult,
  WorkspaceFileReadInput,
  WorkspaceFileReadResult,
  WorkspaceFileResignInput,
} from "../../shared/workspace-files-ipc";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { effectiveLocale } from "./i18n-locale";
import { translate } from "../../shared/i18n/runtime";

declare global {
  interface Window {
    workspaceFiles?: WorkspaceFilesBridgeApi;
  }
}

export async function searchWorkspaceFiles(
  input: WorkspaceFilesSearchInput
): Promise<WorkspaceFilesSearchResult> {
  try {
    if (!window.workspaceFiles) {
      throw new Error(
        translate(effectiveLocale(), "chat.workspaceFiles.bridgeUnavailable")
      );
    }
    return await window.workspaceFiles.search(input);
  } catch (cause) {
    return {
      kind: "unavailable",
      reason: "index-failed",
      detail: errorMessage(
        cause,
        translate(effectiveLocale(), "chat.workspaceFiles.searchFailed")
      ),
    };
  }
}

export async function resignWorkspaceFile(
  input: WorkspaceFileResignInput
): Promise<string> {
  if (!window.workspaceFiles?.resign) {
    throw new Error(
      translate(effectiveLocale(), "chat.workspaceFiles.bridgeUnavailable")
    );
  }
  return (await window.workspaceFiles.resign(input)).readRef;
}

export async function readWorkspaceFile(
  input: WorkspaceFileReadInput
): Promise<WorkspaceFileReadResult> {
  if (!window.workspaceFiles?.read) {
    throw new Error(
      translate(effectiveLocale(), "chat.workspaceFiles.bridgeUnavailable")
    );
  }
  return window.workspaceFiles.read(input);
}
