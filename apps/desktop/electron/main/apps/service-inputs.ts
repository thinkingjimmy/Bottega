/**
 * [INPUT]: Depends on shared apps-ipc/agent-ipc list of input types and backend
 * [OUTPUT]: Provides strict parsers for App id, pin, agent, rename, chat-slot, Use history/open, Editor open, Save-as-App, and removal inputs
 * [POS]: The IPC of the apps module is in the input layer; The app is a state-free function, and AppsService is only a domain assignment, not a format check
 */

import {
  type EnsureAppChatSlotInput,
  type ListAppUseHistoryInput,
  type OpenAppEditorInput,
  type OpenAppEditorChatInput,
  type OpenAppUseChatInput,
  type RemoveAppMode,
  type RenameAppInput,
  type SaveAsAppInput,
  type SetAppAgentInput,
  type SetAppPinnedInput,
} from "../../../shared/apps-ipc";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../shared/agent-ipc";

const APP_ID_PATTERN = /^[a-z0-9]{10}$/;

export function assertAppId(value: unknown) {
  if (typeof value !== "string" || !APP_ID_PATTERN.test(value)) {
    throw new Error("appId 格式无效");
  }
  return value;
}

export function assertSetPinnedInput(value: unknown): SetAppPinnedInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App pin 参数无效");
  }
  const input = value as { appId?: unknown; pinned?: unknown };
  if (
    Object.keys(input).length !== 2 ||
    typeof input.pinned !== "boolean"
  ) {
    throw new Error("App pin 参数无效");
  }
  return { appId: assertAppId(input.appId), pinned: input.pinned };
}

export function isBackendId(value: unknown): value is AgentBackendId {
  return AGENT_BACKEND_ORDER.some((id) => id === value);
}

export function assertSetAgentInput(value: unknown): SetAppAgentInput {
  if (!value || typeof value !== "object") {
    throw new Error("App Agent 设置参数无效");
  }
  const input = value as Partial<SetAppAgentInput>;
  const appId = assertAppId(input.appId);
  if (
    (input.role !== "interactive" && input.role !== "maintenance") ||
    !(input.agent === "auto" || isBackendId(input.agent))
  ) {
    throw new Error("App Agent 设置参数无效");
  }
  return { appId, role: input.role, agent: input.agent };
}

export function assertRenameInput(value: unknown): RenameAppInput {
  if (!value || typeof value !== "object") throw new Error("App 改名参数无效");
  const input = value as Partial<RenameAppInput>;
  if (typeof input.name !== "string") throw new Error("App 改名参数无效");
  return { appId: assertAppId(input.appId), name: input.name };
}

export function assertChatSlotInput(value: unknown): EnsureAppChatSlotInput {
  if (!value || typeof value !== "object") {
    throw new Error("App chat 槽位参数无效");
  }
  const input = value as Partial<EnsureAppChatSlotInput>;
  if (
    (input.role !== "edit" && input.role !== "use") ||
    (input.mode !== undefined &&
      input.mode !== "reuse" &&
      input.mode !== "new") ||
    typeof input.requestId !== "string" ||
    input.requestId.length < 1 ||
    input.requestId.length > 256
  ) {
    throw new Error("App chat 槽位参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    role: input.role,
    requestId: input.requestId,
    ...(input.mode ? { mode: input.mode } : {}),
  };
}

export function assertListAppUseHistoryInput(value: unknown): ListAppUseHistoryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App Use History 参数无效");
  }
  const input = value as Partial<ListAppUseHistoryInput>;
  if (
    (input.cursor !== undefined &&
      (typeof input.cursor !== "string" || input.cursor.length > 256)) ||
    (input.expectedSnapshotRevision !== undefined &&
      (typeof input.expectedSnapshotRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedSnapshotRevision))) ||
    (input.pageSize !== undefined &&
      (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50))
  ) {
    throw new Error("App Use History 参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    ...(input.expectedSnapshotRevision
      ? { expectedSnapshotRevision: input.expectedSnapshotRevision }
      : {}),
  };
}

export function assertOpenAppUseChatInput(value: unknown): OpenAppUseChatInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App Use destination 参数无效");
  }
  const input = value as Partial<OpenAppUseChatInput>;
  if (
    typeof input.chatId !== "string" ||
    !input.chatId ||
    typeof input.incarnationId !== "string" ||
    !/^[a-f0-9]{32}$/.test(input.incarnationId) ||
    typeof input.requestId !== "string" ||
    !input.requestId ||
    input.requestId.length > 256
  ) {
    throw new Error("App Use destination 参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    chatId: input.chatId,
    incarnationId: input.incarnationId,
    requestId: input.requestId,
  };
}

export function assertOpenAppEditorInput(value: unknown): OpenAppEditorInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App Editor destination 参数无效");
  }
  const input = value as Partial<OpenAppEditorInput>;
  if (
    (input.mode !== undefined && input.mode !== "resume" && input.mode !== "new") ||
    typeof input.requestId !== "string" ||
    !input.requestId ||
    input.requestId.length > 256
  ) {
    throw new Error("App Editor destination 参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    requestId: input.requestId,
    ...(input.mode ? { mode: input.mode } : {}),
  };
}

export function assertOpenAppEditorChatInput(
  value: unknown
): OpenAppEditorChatInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("App Editor chat destination 参数无效");
  }
  const input = value as Partial<OpenAppEditorChatInput>;
  if (
    typeof input.projectId !== "string" ||
    !input.projectId ||
    input.projectId.length > 128 ||
    typeof input.chatId !== "string" ||
    !input.chatId ||
    input.chatId.length > 128 ||
    typeof input.incarnationId !== "string" ||
    !/^[a-f0-9]{32}$/.test(input.incarnationId) ||
    typeof input.requestId !== "string" ||
    !input.requestId ||
    input.requestId.length > 256
  ) {
    throw new Error("App Editor chat destination 参数无效");
  }
  return {
    appId: assertAppId(input.appId),
    projectId: input.projectId,
    chatId: input.chatId,
    incarnationId: input.incarnationId,
    requestId: input.requestId,
  };
}

export function assertSaveAsAppInput(value: unknown): SaveAsAppInput {
  if (!value || typeof value !== "object") {
    throw new Error("Save as App 参数无效");
  }
  const input = value as Partial<SaveAsAppInput>;
  if (
    typeof input.chatId !== "string" ||
    !input.chatId ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 120 ||
    typeof input.icon !== "string" ||
    !input.icon.trim() ||
    input.icon.trim().length > 16 ||
    typeof input.requestId !== "string" ||
    !input.requestId
  ) {
    throw new Error("Save as App 参数无效");
  }
  return {
    chatId: input.chatId,
    name: input.name.trim(),
    icon: input.icon.trim(),
    requestId: input.requestId,
  };
}

export function assertRemoveMode(value: unknown): RemoveAppMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "cascade" && value !== "retain-data") {
    throw new Error("App 删除策略无效");
  }
  return value;
}
