/**
 * [INPUT]: Depends on the shared/agent-ipc logic workspace scope, does not accept cwd or absolute paths submitted by the renderer
 * [OUTPUT]: Provides capability-free workspace file/directory search, opaque readRef Re-tick/restricted reading IPC contracts and query/path/index/read Budget constants
 * [POS]: The shared Workspace is recognized by the read-only capability agreement; renderer can only be read short-term in a selected/preview mode for a relative path
 */

import type { AgentWorkspaceScope } from "./agent-ipc";

/** workspace 根下文件的 POSIX 相对路径、basename 与 dirname。 */
export type WorkspaceFileEntry = {
  path: string;
  name: string;
  dir: string;
  entryKind?: "file" | "dir";
};

export type WorkspaceFilesSearchInput = {
  scope: AgentWorkspaceScope;
  query: string;
  /** conversation scope 可直接派生；Project/App 草稿缺省即不启用 recent 加权。 */
  chatId?: string;
};

type WorkspaceFilesUnavailableReason =
  | "no-workspace"
  | "project-unbound"
  | "project-missing"
  | "app-unavailable"
  | "chat-missing"
  | "index-failed";

export type WorkspaceFilesSearchResult =
  | {
      kind: "ready";
      entries: WorkspaceFileEntry[];
      indexed: number;
      indexTruncated: boolean;
      fileIndexTruncated?: boolean;
      directoryIndexTruncated?: boolean;
      /** 本次响应来自仍有效缓存；renderer 仅把它作为下一拍 debounce 启发式。 */
      servedFromCache?: boolean;
    }
  | {
      kind: "unavailable";
      reason: WorkspaceFilesUnavailableReason;
      detail?: string;
    };

export const WORKSPACE_FILES_CHANNEL = {
  search: "workspace-files:search",
  resign: "workspace-files:resign",
  read: "workspace-files:read",
} as const;

export const WORKSPACE_FILE_RESULT_LIMIT = 50;
export const WORKSPACE_FILE_INDEX_LIMIT = 20_000;
export const WORKSPACE_DIRECTORY_INDEX_LIMIT = 4_000;
export const WORKSPACE_FILE_QUERY_BYTE_LIMIT = 256;
export const WORKSPACE_FILE_PATH_BYTE_LIMIT = 4 * 1024;
export const WORKSPACE_FILE_GIT_TIMEOUT_MS = 5_000;
export const WORKSPACE_TEXT_PREVIEW_BYTE_LIMIT = 1024 * 1024;
export const WORKSPACE_READ_BYTE_LIMIT = 8 * 1024 * 1024;

export type WorkspaceFileResignInput = {
  scope: AgentWorkspaceScope;
  path: string;
  entryKind: "file" | "dir";
};

export type WorkspaceFileReadInput = {
  scope: AgentWorkspaceScope;
  readRef: string;
};

type WorkspaceReadMetadata = {
  name: string;
  size: number;
  mtimeMs: number;
};

export type WorkspaceFileReadResult =
  | (WorkspaceReadMetadata & {
      kind: "text";
      content: string;
      mediaType: "text/plain";
    })
  | (WorkspaceReadMetadata & {
      kind: "image";
      dataUrl: string;
      mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    })
  | (WorkspaceReadMetadata & {
      kind: "metadata";
      reason: "too-large" | "binary";
    });

export type WorkspaceFilesBridgeApi = {
  search: (
    input: WorkspaceFilesSearchInput
  ) => Promise<WorkspaceFilesSearchResult>;
  resign?: (input: WorkspaceFileResignInput) => Promise<{ readRef: string }>;
  read?: (input: WorkspaceFileReadInput) => Promise<WorkspaceFileReadResult>;
};

/** 未知/旧 wire 值不得获得目录语义。 */
export const workspaceEntryKind = (value: unknown): "file" | "dir" =>
  value === "dir" ? "dir" : "file";
