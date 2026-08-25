/**
 * [INPUT]: Depends on the trusted work area intent of shared/agent-ipc, keeping the contract sequentialized
 * [OUTPUT]: Provides application-level out-of-chain/clipping boards and user files opaque License Agreement
 * [POS]: The application-level path of shared modules is true source, and the renderer never touches the real path of the local file
 */

import type { AgentWorkspaceScope } from "./agent-ipc";

export const APP_CHANNEL = {
  openExternal: "app:open-external",
  writeClipboard: "app:write-clipboard",
  authorizeFile: "app:authorize-file",
  releaseFile: "app:release-file",
} as const;

export type AuthorizedFile = {
  fileRef: string;
  name: string;
  mediaType: string;
};

export type AppBridgeApi = {
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => Promise<void>;
  /** preload 内部取真实路径，main 签发 scope-bound opaque ref */
  authorizeFile: (
    file: File,
    scope: AgentWorkspaceScope
  ) => Promise<AuthorizedFile>;
  releaseFile: (fileRef: string) => Promise<void>;
};
