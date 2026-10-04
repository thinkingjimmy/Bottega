/**
 * [INPUT]: Depends on the trusted work area intent of shared/agent-ipc, keeping the contract sequentialized
 * [OUTPUT]: Provides application-level external-link/clipboard/file authorization contracts, the FILE_GRANT_EXPIRED marker, plus the read-only system file-manager fact
 * [POS]: apps/desktop/shared/ipc/apps; Shared application bridge truth; renderer receives platform vocabulary and opaque file refs, never native paths
 */

import type { AgentWorkspaceScope } from "../agent/agent-ipc";

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

/** Main's reserve failure for a grant that expired, was used or was released; the message is `${FILE_GRANT_EXPIRED}:${name}`. */
export const FILE_GRANT_EXPIRED = "file-grant-expired";

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
