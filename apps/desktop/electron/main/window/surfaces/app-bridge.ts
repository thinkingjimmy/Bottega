/**
 * [INPUT]: Depends on trusted renderer IPC, file authorization/window ownership, workspace resolution, clipboard, and external-navigation security
 * [OUTPUT]: Provides registerAppBridge for role-scoped external, clipboard, authorize, and release capabilities
 * [POS]: Window surfaces application-capability adapter; App windows receive only the small bridge required by their resident Studio/chat
 */

import { clipboard, type BrowserWindow } from "electron";
import { APP_CHANNEL } from "../../../../shared/app-ipc";
import type { AgentWorkspaceScope } from "../../../../shared/agent-ipc";
import type { resolveAppLocale } from "../../../../shared/i18n/locale";
import type { FileAuthorizationStore } from "../../file-authorizations";
import { rendererIpc } from "../../ipc-registrar";
import type { WorkspaceResolver } from "../../skills-catalog";
import { openExternalSafely } from "../security";
import { surfaceWindowController } from "./surface-window-controller";

export function registerAppBridge(
  window: BrowserWindow,
  rendererUrl: string,
  files: FileAuthorizationStore,
  resolveWorkspace: WorkspaceResolver,
  locale: () => ReturnType<typeof resolveAppLocale>
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的应用级请求")
    .roles("main", "app-window")
    .handleWithContext(APP_CHANNEL.openExternal, async (context, rawUrl) => {
      if (typeof rawUrl !== "string") throw new Error("外链格式无效");
      await openExternalSafely(context.window as BrowserWindow, rawUrl, locale());
    })
    .handle(APP_CHANNEL.writeClipboard, (text) => {
      if (typeof text !== "string") throw new Error("剪贴板内容格式无效");
      clipboard.writeText(text);
    })
    .handleWithContext(APP_CHANNEL.authorizeFile, async (context, raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("文件授权参数无效");
      }
      const input = raw as {
        path?: unknown;
        name?: unknown;
        mediaType?: unknown;
        scope?: unknown;
      };
      if (
        typeof input.path !== "string" ||
        typeof input.name !== "string" ||
        typeof input.mediaType !== "string"
      ) {
        throw new Error("文件授权参数无效");
      }
      const scope = input.scope as AgentWorkspaceScope;
      if (scope?.kind === "conversation") {
        surfaceWindowController.assertConversationMutation(context, scope.conversationId);
      }
      if (
        context.role === "app-window" &&
        (scope?.kind !== "app" || scope.appId !== context.appId) &&
        scope?.kind !== "conversation"
      ) {
        throw new Error("App window file authorization scope mismatch");
      }
      /* app 域授权与 conversation 域同门：只有该 Studio 的驻留窗可发起（合同 2）。 */
      if (scope?.kind === "app") {
        surfaceWindowController.assertAppStudioMutation(context, scope.appId);
      }
      const { workspace } = resolveWorkspace(scope);
      return files.authorize(
        { path: input.path, name: input.name, mediaType: input.mediaType, scope },
        workspace,
        context.windowId
      );
    })
    .handleWithContext(APP_CHANNEL.releaseFile, (context, fileRef) => {
      if (typeof fileRef !== "string") throw new Error("文件授权引用无效");
      files.releaseForWindow(fileRef, context.windowId);
    });
}
