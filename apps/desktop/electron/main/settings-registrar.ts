/**
 * [INPUT]: Depends on Electron dialog/BrowserWindow/app, Node fs/path, shared Settings, platform capabilities, ChatHomeService, backend runtime registry and model-catalog persistence, memory service, workspace resolver, trusted renderer IPC, and surface residence
 * [OUTPUT]: Registers settings and model APIs while excluding presence-owned mode writes; exports listModels, whose empty-list answers cover a Project with no folder on this computer and a closed runtime registry so neither reaches the log as a stack; cached model catalogs avoid process admission, refreshes wait for quota, cold probes retain interactive priority, and the durable model cache is installed here.
 * [POS]: Main Settings admission boundary; App windows receive no global settings envelope and only the backend/session projections required by their resident use chat
 */

import { chatOptionsPatchSchema } from "../../shared/chat-agent/schema";
import { mkdtemp, realpath, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_UNAVAILABLE } from "../../shared/projects-ipc";
import { app, dialog, shell, type BrowserWindow } from "electron";
import type {
  AgentBackendId,
  AgentTurnOptions,
  AgentWorkspaceScope,
} from "../../shared/agent-ipc";
import { SETTINGS_CHANNEL, type RendererSettingsPatch } from "../../shared/settings-ipc";
import { acquireAgentProcessLease } from "./agent-process-supervisor";
import {
  backendById,
  backendRuntimeRegistry,
} from "./backends";
import { configureModelCatalogPersistence } from "./backends/model-catalog";
import { ModelCatalogStore } from "./backends/model-catalog-store";
import { rendererIpc } from "./ipc-registrar";
import {
  assertMemoryMutation,
  type MemorySettingsOwner,
} from "./memory/service/settings-owner";
import { isUsableDirectory } from "./projects/fs-utils";
import type { SettingsStore } from "./settings-store";
import type { WorkspaceResolver } from "./skills-catalog";
import type { ChatHomeService } from "./chat-home/chat-home-service";
import { libraryErrorCode, libraryErrorHost } from "./library/errors";
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
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
  "agentSetupDeferred",
  "computerNameHintSeen",
  "autoRelayLimit",
  "allowCrossChatRead",
  "disabledBuiltinTools",
  "usagePricingAutoRefresh",
  "skillsOnboarding",
  "theme",
  "archiveConfettiEnabled",
  "agentConnectionsEnabled",
  "language",
  "keyboardShortcuts",
]);

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

const settingsLocale = (store: SettingsStore) =>
  resolveAppLocale(store.get().language, app.getPreferredSystemLanguages());

/* A library failure's raw text is a code meant for logs (LIBRARY_IN_USE,
   LIBRARY_IDENTITY_CHANGED, ...). The renderer would paste it verbatim into the
   onboarding alert, so it's swapped here for the code-keyed, five-locale copy
   before leaving; non-library errors are rethrown as-is rather than pretending
   to recognize them. */
async function withLibraryCopy<T>(store: SettingsStore, run: () => Promise<T>) {
  try {
    return await run();
  } catch (cause) {
    const code = libraryErrorCode(cause);
    if (!code) throw cause;
    // `owned-elsewhere` is the one code whose sentence names a computer; the others ignore the parameter.
    throw new Error(translate(settingsLocale(store), `settings.native.library.${code}`, { host: libraryErrorHost(cause) }));
  }
}

async function chooseChatHomesRoot(
  window: BrowserWindow,
  chatHomes: ChatHomeService,
  store: SettingsStore
) {
  const result = await dialog.showOpenDialog(window, {
    title: translate(settingsLocale(store), "settings.native.chooseChatHome"),
    defaultPath: join(app.getPath("home"), "Bottega"),
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
  await withLibraryCopy(store, () => chatHomes.openLibrary(canonical));
  return chatHomes.status();
}

/* Retry never shows the folder picker again: the first pass already chose one,
   so reopening can only target that same folder — picking a different one would
   just run into "changing location isn't supported," trading one failure for
   another. */
async function retryLibrary(chatHomes: ChatHomeService, store: SettingsStore) {
  const configured = store.get().libraryRoot ?? store.get().chatHomesRoot;
  if (!configured) throw new Error("LIBRARY_NOT_CONFIGURED");
  await withLibraryCopy(store, () => chatHomes.openLibrary(configured));
  return chatHomes.status();
}

type RendererContext = Parameters<typeof surfaceWindowController.assertAppStudioMutation>[0];

function assertStudioRead(context: RendererContext) {
  if (context.role === "main") return;
  if (!context.appId) throw new Error("App window identity is missing");
  surfaceWindowController.assertAppStudioMutation(context, context.appId);
}

/* The catalogs are module singletons built at import time, so the durable
   layer is attached here — the first place that both owns `settings:list-models`
   and may ask Electron where userData lives. One store for all four backends. */
let modelCatalogCache: ModelCatalogStore | null = null;

function installModelCatalogCache() {
  if (modelCatalogCache) return;
  modelCatalogCache = new ModelCatalogStore(
    join(app.getPath("userData"), "model-catalog-cache.json")
  );
  configureModelCatalogPersistence(modelCatalogCache);
}

/**
 * `settings:list-models`, extracted so the answer can be exercised without an Electron window.
 * Every "there is nothing to list" case answers with the empty list the renderer already handles,
 * rather than a rejection Electron would expand into a stack in the main log.
 */
export async function listModels(
  context: RendererContext,
  rawBackend: unknown,
  rawScope: unknown,
  resolveWorkspace: WorkspaceResolver
) {
  /* 退出期与 dev 主进程重启期渲染端仍在刷新；注册表已经关了，答一句空表而不是抛一条堆栈 (N-3 / AC-8)。 */
  if (backendRuntimeRegistry.closed) return [];
  const descriptor = backendById(rawBackend as AgentBackendId);
  if (!rawScope || typeof rawScope !== "object" || Array.isArray(rawScope)) {
    throw new Error("模型 workspace scope 格式无效");
  }
  if (context.role === "app-window") {
    const scope = rawScope as Partial<AgentWorkspaceScope>;
    if (scope.kind === "conversation") {
      surfaceWindowController.assertConversationMutation(context, scope.conversationId!);
    } else if (scope.kind === "app" && scope.appId === context.appId) {
      assertStudioRead(context);
    } else {
      throw new Error("App window model scope must match its resident App or conversation");
    }
  }
  /* A Project with no folder on this computer has no catalog to read, and the answer will not change until
     the person picks one. Saying so with the empty list is the whole truth and ends the retry storm that
     PROJECT_UNAVAILABLE kept feeding through the composer (N-2 / AC-7). */
  let workspace: string;
  try {
    workspace = resolveWorkspace(rawScope as AgentWorkspaceScope).workspace;
  } catch (cause) {
    if (!(cause instanceof Error) || !cause.message.startsWith(PROJECT_UNAVAILABLE)) throw cause;
    return [];
  }
  const snapshot = await backendRuntimeRegistry.resolveForSpawn(descriptor.id);
  if (
    snapshot.runtimeStatus !== "installed" ||
    snapshot.capabilities.modelOptions === "none" ||
    !descriptor.models
  ) {
    return [];
  }
  return descriptor.models.list(snapshot.runtime, workspace, undefined, async (read, signal, { background }) => {
    const lease = await acquireAgentProcessLease(
      descriptor.id,
      background ? "background" : "interactive",
      signal,
      { quota: background ? "wait" : "preempt" }
    );
    try {
      return await read();
    } finally {
      lease.release();
    }
  });
}

export function registerSettings(
  window: BrowserWindow,
  rendererUrl: string,
  store: SettingsStore,
  resolveWorkspace: WorkspaceResolver,
  memoryOwner: MemorySettingsOwner,
  chatHomes: ChatHomeService,
  platformSupport?: PlatformCapabilities,
  resetSessionEffective?: (conversationId: string) => void,
  chats?: import("./chats/chats-service").ChatsService
) {
  installModelCatalogCache();
  const assertBackend = (value: unknown): AgentBackendId =>
    backendById(value as AgentBackendId).id;
  const ipc = rendererIpc(rendererUrl, "拒绝非驻留窗口的设置请求");
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
    .handle(SETTINGS_CHANNEL.revealLibrary, async () => {
      const root = store.get().libraryRoot ?? store.get().chatHomesRoot;
      if (!root) throw new Error("LIBRARY_NOT_CONFIGURED");
      const error = await shell.openPath(root);
      if (error) throw new Error(error);
    })
    .handle(SETTINGS_CHANNEL.chooseChatHomesRoot, () =>
      chooseChatHomesRoot(window, chatHomes, store)
    )
    .handle(SETTINGS_CHANNEL.retryLibrary, () => retryLibrary(chatHomes, store))
    .handle(SETTINGS_CHANNEL.acknowledgeFullAccess, () =>
      store.acknowledgeFullAccess()
    )
    .roles("main", "app-window")
    .handleWithContext(SETTINGS_CHANNEL.listBackends, async (context) => {
      assertStudioRead(context);
      return backendRuntimeRegistry.listSnapshots();
    })
    .handleWithContext(SETTINGS_CHANNEL.listModels, (context, rawBackend, rawScope) =>
      listModels(context, rawBackend, rawScope, resolveWorkspace)
    )
    .handleWithContext(SETTINGS_CHANNEL.getBackendDefaults, (context, rawBackend) => {
      assertStudioRead(context);
      return store.getBackendDefaults(rawBackend === undefined ? undefined : assertBackend(rawBackend));
    })
    .handleWithContext(SETTINGS_CHANNEL.patchChatOptions, async (context, raw, reset) => {
      const input = chatOptionsPatchSchema.parse(raw);
      surfaceWindowController.assertConversationMutation(context, input.chatId);
      if (!chats) throw new Error("Chat options authority is unavailable");
      if (input.patch.permissionMode === "full-access" && !store.get().fullAccessAcknowledgedAt) throw new Error("FULL_ACCESS_ACK_REQUIRED");
      if (reset !== undefined && typeof reset !== "boolean") throw new Error("Invalid session reset flag");
      const result = await chats.store.patchOptions(input);
      if (reset === true) resetSessionEffective?.(input.chatId);
      chats.publishRecord(result);
      return { agent: result.agent, agentRevision: result.agentRevision, chatRecordRevision: result.chatRecordRevision, options: result.options };
    })
    .roles("main")
    .handle(SETTINGS_CHANNEL.rememberChatDefaults, (options) => store.rememberChatDefaults(options as AgentTurnOptions));
  /* 变更广播是 renderer rebase 的前提：没有它，外部写入永远到不了
     renderer，后续 patch 全部基于陈旧基线计算。 */
  const unwatch = store.onChanged((envelope) => {
    if (!window.isDestroyed()) {
      window.webContents.send(SETTINGS_CHANNEL.changed, envelope);
    }
  });
  const unwatchHome = chatHomes.onStatus(status => {
    if (!window.isDestroyed()) window.webContents.send(SETTINGS_CHANNEL.chatHomeChanged, status);
  });
  window.once("closed", () => {
    unwatch();
    unwatchHome();
  });
}
