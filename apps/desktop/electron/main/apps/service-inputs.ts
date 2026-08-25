/**
 * [INPUT]: Depends on shared apps-ipc/agent-ipc list of input types and backend
 * [OUTPUT]: The app is available for all users of the app
 * [POS]: The IPC of the apps module is in the input layer; The app is a state-free function, and AppsService is only a domain assignment, not a format check
 */

import {
  type EnsureAppChatSlotInput,
  type RemoveAppMode,
  type RenameAppInput,
  type SaveAsAppInput,
  type SetAppAgentInput,
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
