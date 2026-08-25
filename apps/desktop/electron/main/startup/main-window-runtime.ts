/**
 * [INPUT]: Depends on the main-window combination parameters, AppsService, BuiltinToolRegistry and chat incarnation mouse reader
 * [OUTPUT]: Provides reusable main window launcher and Browser/App GUI E2E driver installers limited by environmental variables
 * [POS]: The startup window is separated from the E2E combination layer; Remove the parameter duplication of the activate path, E2E rebuild Reuse production explicit generation cutover, no service lifecycle
 */

import { randomUUID } from "node:crypto";
import {
  BUILTIN_TOOL_SPECS,
  type BuiltinToolName,
} from "../../../shared/builtin-tools";
import type { AppsService } from "../apps/apps-service";
import type { BuiltinMcpLease } from "../tools/lease";
import type { BuiltinToolRegistry } from "../tools/registry";
import { createMainWindow } from "../window/main-window";

export function createMainWindowLauncher(
  options: Parameters<typeof createMainWindow>[0]
) {
  return () => createMainWindow(options);
}

type BrowserE2eDriver = {
  call(chatId: string, tool: BuiltinToolName, args: unknown): Promise<unknown>;
};

type AppGuiE2eDriver = {
  rebuild(appId: string, conversationId: string): Promise<void>;
};

export function installAppGuiE2eDriver(service: AppsService) {
  if (process.env.AI_CHAT_APP_GUI_E2E !== "1") return;
  const scope = globalThis as typeof globalThis & {
    __aiChatAppGuiE2E?: AppGuiE2eDriver;
  };
  scope.__aiChatAppGuiE2E = {
    async rebuild(appId, conversationId) {
      await service.onAppTurnCompleted(
        appId,
        conversationId,
        `gui-e2e-${randomUUID()}`
      );
    },
  };
}

export function installBrowserE2eDriver(
  registry: BuiltinToolRegistry,
  getIncarnationId: (chatId: string) => string | undefined
) {
  if (process.env.AI_CHAT_BROWSER_E2E !== "1") return;
  const scope = globalThis as typeof globalThis & {
    __aiChatBrowserE2E?: BrowserE2eDriver;
  };
  const controller = new AbortController();
  scope.__aiChatBrowserE2E = {
    async call(chatId, tool, args) {
      const incarnationId = getIncarnationId(chatId);
      if (!incarnationId) throw new Error("Browser E2E chat 不存在");
      const lease: BuiltinMcpLease = {
        leaseId: "browser-e2e",
        chatId,
        incarnationId,
        requestId: "browser-e2e",
        generation: 1,
        allowedTools: BUILTIN_TOOL_SPECS.map((spec) => spec.name),
        initiatorBackend: "codex",
        resultByteBudget: 512 * 1024,
        socketToken: "browser-e2e",
        signal: controller.signal,
        state: "ready",
      };
      return registry.call(tool, args, {
        lease,
        invocationId: `browser-e2e:${tool}`,
        signal: controller.signal,
      });
    },
  };
}
