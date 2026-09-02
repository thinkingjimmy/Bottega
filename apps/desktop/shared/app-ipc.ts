/**
 * [INPUT]: Depends on the trusted work area intent of shared/agent-ipc, keeping the contract sequentialized
 * [OUTPUT]: Provides application-level external-link/clipboard/file authorization contracts plus the read-only system file-manager fact
 * [POS]: Shared application bridge truth; renderer receives platform vocabulary and opaque file refs, never native paths
 */

import type { AgentWorkspaceScope } from "./agent-ipc";

export const APP_CHANNEL = {
  openExternal: "app:open-external",
  writeClipboard: "app:write-clipboard",
  authorizeFile: "app:authorize-file",
  releaseFile: "app:release-file",
} as const;

export type SystemFileManager = "finder" | "file-explorer" | "file-manager";

export function systemFileManagerForPlatform(
  platform: string
): SystemFileManager {
  if (platform === "darwin") return "finder";
  if (platform === "win32") return "file-explorer";
  return "file-manager";
}

export type AuthorizedFile = {
  fileRef: string;
  name: string;
  mediaType: string;
};

export type AppBridgeApi = {
  readonly systemFileManager: SystemFileManager;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  /** preload 内部取真实路径，main 签发 scope-bound opaque ref */
  authorizeFile: (
    file: File,
    scope: AgentWorkspaceScope
  ) => Promise<AuthorizedFile>;
  releaseFile: (fileRef: string) => Promise<void>;
};
