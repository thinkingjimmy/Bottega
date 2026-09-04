/**
 * [INPUT]: Depends on zod, app-store-schema APP_ID_PATTERN, the shared agent backend order, and the apps-ipc input DTOs
 * [OUTPUT]: Provides strict parsers for App id, pin, agent, rename, chat slot, Use history/open, Editor open, Save as App, and removal inputs
 * [POS]: The input boundary of the apps IPC layer; every parser is a pure function so AppsService only decides domain outcomes and never re-checks shapes
 */

import { z } from "zod";
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
import { AGENT_BACKEND_ORDER } from "../../../shared/agent-ipc";
import { APP_ID_PATTERN } from "./store/app-store-schema";

/* ── 共用字面量:同一个概念只允许有一份形状定义 ───────────────────── */
const appId = z.string().regex(APP_ID_PATTERN);
const requestId = z.string().min(1).max(256);
const chatId = z.string().min(1);
const incarnationId = z.string().regex(/^[a-f0-9]{32}$/);
const backend = z.enum(AGENT_BACKEND_ORDER);

/** zod 只判形状,报错文案仍归领域所有——渲染进程按这句话认错，不按 zod 的路径认错。 */
function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(message);
  return result.data;
}

const setPinned = z.object({ appId, pinned: z.boolean() }).strict();
const setAgent = z.object({
  appId,
  role: z.enum(["interactive", "maintenance"]),
  agent: z.union([z.literal("auto"), backend]),
});
const rename = z.object({ appId, name: z.string() });
const chatSlot = z.object({
  appId,
  role: z.enum(["edit", "use"]),
  requestId,
  mode: z.enum(["reuse", "new"]).optional(),
});
const useHistory = z.object({
  appId,
  cursor: z.string().max(256).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  expectedSnapshotRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
const openUseChat = z.object({ appId, chatId, incarnationId, requestId });
const openEditor = z.object({
  appId,
  requestId,
  mode: z.enum(["resume", "new"]).optional(),
});
const openEditorChat = z.object({
  appId,
  projectId: z.string().min(1).max(128),
  chatId: z.string().min(1).max(128),
  incarnationId,
  requestId,
});
/** Save as App 参数的唯一裁判点:IPC 与 SaveAsAppService 都只认这一份。 */
const saveAsApp = z.object({
  chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  name: z.string().trim().min(1).max(120),
  icon: z.string().trim().min(1).max(16),
  requestId: z.string().min(1),
});

export function assertAppId(value: unknown) {
  return parse(appId, value, "appId 格式无效");
}

export function assertSetPinnedInput(value: unknown): SetAppPinnedInput {
  return parse(setPinned, value, "App pin 参数无效");
}

export function assertSetAgentInput(value: unknown): SetAppAgentInput {
  return parse(setAgent, value, "App Agent 设置参数无效");
}

export function assertRenameInput(value: unknown): RenameAppInput {
  return parse(rename, value, "App 改名参数无效");
}

export function assertChatSlotInput(value: unknown): EnsureAppChatSlotInput {
  return parse(chatSlot, value, "App chat 槽位参数无效");
}

export function assertListAppUseHistoryInput(
  value: unknown
): ListAppUseHistoryInput {
  return parse(useHistory, value, "App Use History 参数无效");
}

export function assertOpenAppUseChatInput(value: unknown): OpenAppUseChatInput {
  return parse(openUseChat, value, "App Use destination 参数无效");
}

export function assertOpenAppEditorInput(value: unknown): OpenAppEditorInput {
  return parse(openEditor, value, "App Editor destination 参数无效");
}

export function assertOpenAppEditorChatInput(
  value: unknown
): OpenAppEditorChatInput {
  return parse(openEditorChat, value, "App Editor chat destination 参数无效");
}

export function assertSaveAsAppInput(value: unknown): SaveAsAppInput {
  return parse(saveAsApp, value, "Save as App 参数无效");
}

export function assertRemoveMode(value: unknown): RemoveAppMode | undefined {
  if (value === undefined) return undefined;
  return parse(z.enum(["cascade", "retain-data"]), value, "App 删除策略无效");
}
