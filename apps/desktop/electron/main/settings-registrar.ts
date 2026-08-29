/**
 * [INPUT]: Depends on Electron dialog/BrowserWindow, Node fs/path, shared Settings, platform capabilities, ChatHomeService, backend runtime registry, memory service, workspace resolver, trusted renderer IPC, and surface residence
 * [OUTPUT]: Provides registerSettings, validated Skills-onboarding preference, main-only global controls, residence-gated chat options, and explicit session-effective reset dispatch
 * [POS]: Main Settings admission boundary; App windows receive no global settings envelope and only the backend/session projections required by their resident use chat
 */

import { mkdtemp, realpath, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type {
  AgentBackendId,
  AgentScope,
  AgentTurnOptions,
  AgentWorkspaceScope,
} from "../../shared/agent-ipc";
import { SETTINGS_CHANNEL, type RendererSettingsPatch } from "../../shared/settings-ipc";
import { acquireAgentProcessLease } from "./agent-process-supervisor";
import {
  backendById,
  backendRuntimeRegistry,
  orderedBackends,
} from "./backends";
import { rendererIpc } from "./ipc-registrar";
import {
  assertMemoryMutation,
  type MemorySettingsOwner,
} from "./memory/service/settings-owner";
import { isUsableDirectory } from "./projects/fs-utils";
import type { SettingsStore } from "./settings-store";
import type { WorkspaceResolver } from "./skills-catalog";
import type { ChatHomeService } from "./chat-home/chat-home-service";
import { resolveAppLocale } from "../../shared/i18n/locale";
import { translate } from "../../shared/i18n/runtime";
import {
  assertPlatformCapability,
  type PlatformCapabilities,
} from "../../shared/platform-capabilities";
import { surfaceWindowController } from "./window/surfaces/surface-window-controller";

/* memory 不在册：它有自己的 discriminated mutation 出口。
   类型层已 Omit，这里是运行时的第二道门——一个域只有一个入口，
   守护才不会被「反正 set 也能写」绕过。 */
const RENDERER_SETTINGS_KEYS = new Set([
  "titleAgent",
  "titleModelByBackend",
  "defaultChatOptionsByBackend",
  "lastSelectedBackend",
  "autoRelayLimit",
  "allowCrossChatRead",
  "disabledBuiltinTools",
  "usagePricingAutoRefresh",
  "skillsOnboarding",
  "theme",
  "language",
  "keyboardShortcuts",
]);

/** renderer 传入的 scope 是不可信输入，进 store 前收敛为合法 AgentScope。 */
function assertScope(value: unknown): AgentScope {
  const scope = value as Partial<AgentScope> | null;
  if (
    scope !== null &&
    typeof scope === "object" &&
    Object.keys(scope).length === 1 &&
    typeof scope?.conversationId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(scope.conversationId)
  ) {
    return { conversationId: scope.conversationId };
  }
  throw new Error("Agent scope 格式无效");
}

export function assertRendererSettingsPatch(
  value: unknown
): RendererSettingsPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("设置格式无效");
  }
  for (const key of Object.keys(value)) {
    if (!RENDERER_SETTINGS_KEYS.has(key)) {
      throw new Error(`renderer 无权修改设置字段：${key}`);
    }
  }
  return value as RendererSettingsPatch;
}

async function chooseChatHomesRoot(
  window: BrowserWindow,
  chatHomes: ChatHomeService,
  store: SettingsStore
) {
  const locale = resolveAppLocale(
    store.get().language,
    app.getPreferredSystemLanguages()
  );
  const result = await dialog.showOpenDialog(window, {
    title: translate(locale, "settings.native.chooseChatHome"),
    properties: ["openDirectory", "createDirectory"],
  });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  const canonical = await realpath(selected);
  if (!isUsableDirectory(canonical)) throw new Error("所选文件夹不可用");
  let probe: string | undefined;
  try {
    probe = await mkdtemp(join(canonical, ".ai-chat-write-"));
  } finally {
    if (probe) await rmdir(probe);
  }
  await chatHomes.chooseRoot(canonical);
  return chatHomes.status();
}

export function registerSettings(
  window: BrowserWindow,
  rendererUrl: string,
  store: SettingsStore,
  resolveWorkspace: WorkspaceResolver,
  memoryOwner: MemorySettingsOwner,
  chatHomes: ChatHomeService,
  platformSupport?: PlatformCapabilities,
  resetSessionEffective?: (conversationId: string) => void
) {
  const assertBackend = (value: unknown): AgentBackendId =>
    backendById(value as AgentBackendId).id;
  const ipc = rendererIpc(window, rendererUrl, "拒绝非驻留窗口的设置请求");
  const assertStudioRead = (context: Parameters<typeof surfaceWindowController.assertAppStudioMutation>[0]) => {
    if (context.role === "main") return;
    if (!context.appId) throw new Error("App window identity is missing");
    surfaceWindowController.assertAppStudioMutation(context, context.appId);
  };
  const assertConversationScope = (
    context: Parameters<typeof surfaceWindowController.assertConversationMutation>[0],
    value: unknown
  ) => {
    const scope = assertScope(value);
    if (context.role === "app-window") {
      surfaceWindowController.assertConversationMutation(
        context,
        scope.conversationId
      );
    }
    return scope;
  };
  ipc
    .handle(SETTINGS_CHANNEL.get, () => store.envelope())
    .handle(SETTINGS_CHANNEL.set, (rawPatch) =>
      store.set(assertRendererSettingsPatch(rawPatch))
    )
    .handle(SETTINGS_CHANNEL.mutateMemory, (raw) => {
      if (platformSupport) {
        assertPlatformCapability(platformSupport, "memory");
      }
      return memoryOwner.mutate(assertMemoryMutation(raw));
    })
    .handle(SETTINGS_CHANNEL.getChatHomeStatus, () => chatHomes.status())
    .handle(SETTINGS_CHANNEL.chooseChatHomesRoot, () =>
      chooseChatHomesRoot(window, chatHomes, store)
    )
    .handle(SETTINGS_CHANNEL.acknowledgeFullAccess, () =>
      store.acknowledgeFullAccess()
    )
    .roles("main", "app-window")
    .handleWithContext(SETTINGS_CHANNEL.listBackends, async (context) => {
      assertStudioRead(context);
      return Promise.all(
        orderedBackends().map(async (descriptor) => {
          const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
          return backendRuntimeRegistry.toBackendInfo(
            descriptor.id,
            snapshot
          );
        })
      );
    })
    .handleWithContext(SETTINGS_CHANNEL.listModels, async (context, rawBackend, rawScope) => {
      const descriptor = backendById(assertBackend(rawBackend));
      if (
        !rawScope ||
        typeof rawScope !== "object" ||
        Array.isArray(rawScope)
      ) {
        throw new Error("模型 workspace scope 格式无效");
      }
      if (context.role === "app-window") {
        const scope = rawScope as Partial<AgentWorkspaceScope>;
        if (scope.kind === "conversation") {
          assertConversationScope(context, { conversationId: scope.conversationId });
        } else if (scope.kind === "app" && scope.appId === context.appId) {
          assertStudioRead(context);
        } else {
          throw new Error("App window model scope must match its resident App or conversation");
        }
      }
      const { workspace } = resolveWorkspace(
        rawScope as AgentWorkspaceScope
      );
      const snapshot = await backendRuntimeRegistry.resolveForSpawn(
        descriptor.id
      );
      if (
        snapshot.runtimeStatus !== "installed" ||
        snapshot.capabilities.modelOptions === "none" ||
        !descriptor.models
      ) {
        return [];
      }
      const lease = await acquireAgentProcessLease(
        descriptor.id,
        "interactive"
      );
      try {
        return await descriptor.models.list(snapshot.runtime, workspace);
      } finally {
        lease.release();
      }
    })
    .handleWithContext(SETTINGS_CHANNEL.resolveChatOptions, (context, scope, rawBackend) =>
      store.resolveChatOptions(
        assertConversationScope(context, scope),
        rawBackend === undefined ? undefined : assertBackend(rawBackend)
      )
    )
    .handleWithContext(
      SETTINGS_CHANNEL.setChatOptions,
      async (context, rawScope, options, rawResetSessionEffective) => {
        if (
          rawResetSessionEffective !== undefined &&
          typeof rawResetSessionEffective !== "boolean"
        ) {
          throw new Error("Speed session reset 标记无效");
        }
        const scope = assertConversationScope(context, rawScope);
        const stored = await store.setChatOptions(
          scope,
          options as AgentTurnOptions
        );
        if (rawResetSessionEffective === true) {
          resetSessionEffective?.(scope.conversationId);
        }
        return stored;
      }
    );
  /* 变更广播是 renderer rebase 的前提：没有它，外部写入永远到不了
     renderer，后续 patch 全部基于陈旧基线计算。 */
  const unwatch = store.onChanged((envelope) => {
    if (!window.isDestroyed()) {
      window.webContents.send(SETTINGS_CHANNEL.changed, envelope);
    }
  });
  window.once("closed", () => {
    unwatch();
  });
}
