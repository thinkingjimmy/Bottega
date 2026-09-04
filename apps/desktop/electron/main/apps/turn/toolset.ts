/**
 * [INPUT]: Depends on incarnation-bound tools lease, chat roles/Project
 * [OUTPUT]: Provides createAppToolset, binding validate_app to the self-check of "edit chat → App directory"
 * [POS]: The only adaptation layer to the general built-in tool platform in the app space; The App identity is derived from lease only, and the parameters cannot falsify scope
 */

import type { AppChatRole } from "../../../../shared/chats-ipc";
import type { BuiltinToolset } from "../../tools/registry";
import { validateAppPackage } from "../source/validate-app";

export type AppToolsetPorts = {
  appRoleOf(chatId: string): AppChatRole | null | undefined;
  projectIdOf(chatId: string): string | null | undefined;
  appIdOfProject(projectId: string): string | undefined;
  appDirOf(appId: string): string | undefined;
};

export function createAppToolset(ports: AppToolsetPorts): BuiltinToolset {
  return {
    validate_app: async (_args, context) => {
      const { appId, dir } = resolveEditApp(ports, context.lease.chatId);
      return { app_id: appId, ...(await validateAppPackage(dir)) };
    },
  };
}

/**
 * 自检只对编辑 chat 开放：使用 chat 不做包手术，窄面少一类误用。
 * 每一步失败都如实说清缺哪一环，不猜一个「大概是这个 App」的目标。
 */
function resolveEditApp(ports: AppToolsetPorts, chatId: string) {
  const role = ports.appRoleOf(chatId);
  if (role !== "edit") {
    throw new Error(
      role === "use"
        ? "validate_app 只在编辑 chat 可用；使用 chat 不做包手术"
        : "当前 chat 没有绑定 App，validate_app 无从判断校验目标"
    );
  }
  const projectId = ports.projectIdOf(chatId);
  const appId = projectId ? ports.appIdOfProject(projectId) : undefined;
  const dir = appId ? ports.appDirOf(appId) : undefined;
  if (!appId || !dir) throw new Error("App 不可用（不存在或正在维护）");
  return { appId, dir };
}
