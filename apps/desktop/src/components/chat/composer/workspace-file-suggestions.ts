/**
 * [INPUT]: Depends on WorkspaceFilesState from runtime/use-workspace-files
 * [OUTPUT]: Provides workspaceFilesNote, deriving a status note for the loading state, both empty-ready states, and each of six unavailable reasons
 * [POS]: Workspace-file candidate note boundary for chat/composer; RichInput only renders the returned note text, never the state machine itself
 */

import type { WorkspaceFilesState } from "../runtime/use-workspace-files";

function assertNever(value: never): never {
  throw new Error(`未处理的 Workspace Files 状态：${String(value)}`);
}

export function workspaceFilesNote(state: WorkspaceFilesState) {
  if (state.loading) return "正在搜索…";
  if (state.kind === "ready") {
    if (state.indexed === 0) return "这个 workspace 里还没有文件";
    return state.entries.length === 0 ? "没有匹配的文件" : undefined;
  }
  switch (state.reason) {
    case "no-workspace":
      return "这个聊天还没有自己的文件夹；发出第一条消息后即可引用它里面的文件，或先选择一个 Project";
    case "project-unbound":
      return "这个 Project 还没绑定工作目录";
    case "project-missing":
      return "这个 Project 的文件夹已丢失";
    case "app-unavailable":
      return "App 暂不可用";
    case "chat-missing":
      return "找不到这个聊天的文件夹";
    case "index-failed":
      return `文件索引失败：${state.detail || "未知错误"}`;
    default:
      return assertNever(state.reason);
  }
}
