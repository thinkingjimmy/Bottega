/**
 * [INPUT]: Depends on the live Provider catalog and its IPC narrowing (withProviderTarget), Electron dialog/BrowserWindow/app, Node fs/path, shared Settings, platform capabilities, ChatHomeService, backend runtime registry and model-catalog persistence, memory service, workspace resolver, trusted renderer IPC, and surface residence
 * [OUTPUT]: Registers settings and model APIs (the folder chooser, onboarding's suggested folder — offered and opened only after main re-derives it — and retry share one write probe and open) while excluding presence-owned mode writes; exports acknowledgeFullAccessFor (Full Access acknowledged from main, or from an App window only for a Chat resident in it), backendDefaultsFor and rememberChatDefaultsFor (TASK-11 S3-c: a malformed or unknown Provider id answers a ProviderIpcRefusal), and listModels (which answers the same refusal), whose empty-list answers cover a Project with no folder on this computer and a closed runtime registry so neither reaches the log as a stack; cached model catalogs avoid process admission, refreshes wait for quota, cold probes retain interactive priority, and the durable model cache is installed here. The settings envelope (settings:get, readSettingsEnvelope) is also readable by an App window holding its Studio, and its changes reach App windows.
 * [POS]: apps/desktop/electron/main/registration; Main Settings admission boundary; App windows receive no global settings envelope and only the backend/session projections required by their resident use chat
 */

import { providerIdSchema } from "@bottega/contracts/model/provider";
import { resolveProvider } from "../backends";
import { z } from "zod";
import { chatOptionsPatchSchema } from "../../../shared/chat-agent/schema";
import { mkdtemp, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PROJECT_UNAVAILABLE } from "../../../shared/ipc/workspace/projects-ipc";
import { app, dialog, shell, type BrowserWindow } from "electron";
import type { AgentWorkspaceScope } from "../../../shared/ipc/agent/agent-ipc";
import { withProviderTarget, type ProviderCatalog } from "../../../shared/providers/catalog";
import { providerCatalog } from "../providers/host/catalog";
import { SETTINGS_CHANNEL, type RendererSettingsPatch } from "../../../shared/ipc/settings/settings-ipc";
import { acquireAgentProcessLease } from "../agent-process-supervisor";
import {
  backendRuntimeRegistry,
} from "../backends";
import { configureModelCatalogPersistence } from "../backends/models/model-catalog";
import { ModelCatalogStore } from "../backends/models/model-catalog-store";
import { rendererIpc } from "./ipc-registrar";
import {
  assertMemoryMutation,
  type MemorySettingsOwner,
} from "../memory/service/settings-owner";
import { isUsableDirectory } from "../projects/fs-utils";
import type { SettingsStore } from "../settings/settings-store";
import type { WorkspaceResolver } from "../skills/catalog/skills-catalog";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import { libraryErrorCode, libraryErrorHost } from "../library/errors";
import { resolveLibraryChoice, suggestLibraryFolder } from "../library/safety/admission";
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../shared/i18n/native";
import {
  assertPlatformCapability,
  type PlatformCapabilities,
} from "../../../shared/platform/platform-capabilities";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { windowRegistry } from "../window/surfaces/window-registry";

/* memory 不在册：它有自己的 discriminated mutation 出口。
   类型层已 Omit，这里是运行时的第二道门——一个域只有一个入口，
   守护才不会被「反正 set 也能写」绕过。 */
const RENDERER_SETTINGS_KEYS = new Set([
  "titleAgent",
  "titleModelByBackend",
  "defaultChatOptionsByBackend",
  "defaultBackend",
  "providerOrder",
  "agentSetupDeferred",
  "computerNameHintSeen",
  "autoRelayLimit",
  "allowCrossChatRead",
  "memoryPhoneFacade",
  "disabledBuiltinTools",
  "usagePricingAutoRefresh",
  "skillsOnboarding",
  "theme",
  "archiveConfettiEnabled",
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
  const locale = settingsLocale(store);
  // The same home the admission rule protects (they differ only when a test sets HOME).
  const home = homedir(), suggested = join(home, "Bottega");
  const result = await dialog.showOpenDialog(window, {
    title: translate(locale, "settings.native.chooseChatHome"),
    defaultPath: isUsableDirectory(suggested) ? suggested : home,
    properties: ["openDirectory", "createDirectory"],
  });
  const selected = result.filePaths[0];
  if (result.canceled || !selected) return null;
  if (!isUsableDirectory(selected)) throw new Error(translate(locale, "settings.native.folderUnavailable"));
  /* Opening the picker at home and pressing Open is the easy mistake; a folder that already holds
     the person's files is never taken over, only offered a new Bottega folder inside it. */
  const choice = await withLibraryCopy(store, () => resolveLibraryChoice(selected));
  if (choice.subfolder && !await confirmNestedFolder(window, locale, dirname(choice.root), choice.root)) return null;
  return openLibraryAt(chatHomes, store, choice.root, choice.subfolder ? dirname(choice.root) : choice.root);
}

/* The suggestion is computed again here: the renderer only names the path it showed, and a folder
   that appeared at that name since then is refused rather than opened behind the person's back. */
async function openSuggestedChatHomesRoot(chatHomes: ChatHomeService, store: SettingsStore, shown: unknown) {
  const suggestion = await suggestLibraryFolder();
  if (!suggestion || typeof shown !== "string" || shown !== suggestion.path) {
    throw new Error(translate(settingsLocale(store), "settings.native.folderUnavailable"));
  }
  return openLibraryAt(chatHomes, store, suggestion.path, dirname(suggestion.path));
}

async function openLibraryAt(chatHomes: ChatHomeService, store: SettingsStore, root: string, writable: string) {
  let probe: string | undefined;
  try {
    probe = await mkdtemp(join(writable, ".ai-chat-write-"));
  } finally {
    if (probe) await rmdir(probe);
  }
  await withLibraryCopy(store, () => chatHomes.openLibrary(root));
  return chatHomes.status();
}

async function confirmNestedFolder(window: BrowserWindow, locale: ReturnType<typeof settingsLocale>, folder: string, path: string) {
  const { response } = await dialog.showMessageBox(window, {
    type: "question",
    title: translate(locale, "settings.native.libraryNestMessage"),
    message: translate(locale, "settings.native.libraryNestMessage"),
    detail: translate(locale, "settings.native.libraryNestDetail", { folder: basename(folder) || folder, path }),
    buttons: [translate(locale, "settings.native.libraryNestConfirm"), translate(locale, "settings.native.libraryNestCancel")],
    defaultId: 0, cancelId: 1, noLink: true,
  });
  return response === 0;
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

const assertStudioRead = (context: RendererContext) => surfaceWindowController.assertStudioRead(context);

const fullAccessAckSchema = z.object({ chatId: z.string().min(1) }).strict();
/**
 * `settings:full-access:acknowledge`: main as before; an App window only for a Chat resident in it (its Use or Edit Chat), so the
 * acknowledgement is bound to a conversation that window holds. The main frame is enforced for every channel by the registrar.
 */
export function acknowledgeFullAccessFor(context: RendererContext, raw: unknown, store: Pick<SettingsStore, "acknowledgeFullAccess">,
  assertConversation = (target: RendererContext, chatId: string) => surfaceWindowController.assertConversationMutation(target, chatId)) {
  if (context.role === "app-window") assertConversation(context, fullAccessAckSchema.parse(raw).chatId);
  return store.acknowledgeFullAccess();
}

/** `settings:get`: main, or an App window holding its Studio (its composer reads the same envelope; settings writes stay main-only). */
export function readSettingsEnvelope(context: RendererContext, store: Pick<SettingsStore, "envelope">, assertRead = assertStudioRead) {
  assertRead(context);
  return store.envelope();
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
  resolveWorkspace: WorkspaceResolver,
  catalog?: ProviderCatalog
) {
  /* 退出期与 dev 主进程重启期渲染端仍在刷新；注册表已经关了，答一句空表而不是抛一条堆栈 (N-3 / AC-8)。 */
  if (backendRuntimeRegistry.closed) return [];
  const id = providerIdSchema.safeParse(rawBackend);
  if (!id.success) return { status: "invalid-input" as const };
  const available = (catalog ?? providerCatalog().catalog()).get(id.data).known;
  const descriptor = available ? resolveProvider(id.data) : null;
  if (!descriptor) return { status: "unknown-provider" as const, id: id.data };
  return modelsFor(context, descriptor, rawScope, resolveWorkspace);
}

async function modelsFor(context: RendererContext, descriptor: NonNullable<ReturnType<typeof resolveProvider>>, rawScope: unknown, resolveWorkspace: WorkspaceResolver) {
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

/** `settings:backend-defaults`: no id reads the default Agent's; a malformed or unknown id answers its refusal (TASK-11 S3-c). */
export function backendDefaultsFor(store: Pick<SettingsStore, "getBackendDefaults">, rawBackend: unknown, catalog: ProviderCatalog) {
  return rawBackend === undefined ? store.getBackendDefaults() : withProviderTarget(rawBackend, catalog, backend => store.getBackendDefaults(backend));
}

/** `settings:remember-chat-defaults`: the options' own backend is checked before the store parses them; no cast. */
export function rememberChatDefaultsFor(store: Pick<SettingsStore, "rememberChatDefaults">, raw: unknown, catalog: ProviderCatalog) {
  const backend = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { backend?: unknown }).backend : undefined;
  return withProviderTarget(backend, catalog, () => store.rememberChatDefaults(raw));
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
  chats?: import("../chats/service/chats-service").ChatsService
) {
  installModelCatalogCache();
  const catalog = () => providerCatalog().catalog();
  const ipc = rendererIpc(rendererUrl, "拒绝非驻留窗口的设置请求");
  ipc
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
    .handle(SETTINGS_CHANNEL.suggestChatHomesRoot, async () => {
      const suggestion = await suggestLibraryFolder();
      return suggestion && { path: suggestion.path, name: suggestion.name, kind: suggestion.kind };
    })
    .handle(SETTINGS_CHANNEL.openSuggestedChatHomesRoot, (shown) =>
      openSuggestedChatHomesRoot(chatHomes, store, shown)
    )
    .handle(SETTINGS_CHANNEL.retryLibrary, () => retryLibrary(chatHomes, store))
    .roles("main", "app-window")
    .handleWithContext(SETTINGS_CHANNEL.acknowledgeFullAccess, (context, raw) => acknowledgeFullAccessFor(context, raw, store))
    .handleWithContext(SETTINGS_CHANNEL.get, (context) => readSettingsEnvelope(context, store))
    .handleWithContext(SETTINGS_CHANNEL.listBackends, async (context) => {
      assertStudioRead(context);
      return backendRuntimeRegistry.listSnapshots();
    })
    .handleWithContext(SETTINGS_CHANNEL.listModels, (context, rawBackend, rawScope) =>
      listModels(context, rawBackend, rawScope, resolveWorkspace, catalog())
    )
    .handleWithContext(SETTINGS_CHANNEL.getBackendDefaults, (context, rawBackend) => {
      assertStudioRead(context);
      return backendDefaultsFor(store, rawBackend, catalog());
    })
    .handleWithContext(SETTINGS_CHANNEL.patchChatOptions, (context, raw, reset) =>
      withProviderTarget(raw && typeof raw === "object" ? (raw as { expectedAgent?: unknown }).expectedAgent : undefined, catalog(), async () => {
      const input = chatOptionsPatchSchema.parse(raw);
      surfaceWindowController.assertConversationMutation(context, input.chatId);
      if (!chats) throw new Error("Chat options authority is unavailable");
      if (input.patch.permissionMode === "full-access" && !store.get().fullAccessAcknowledgedAt) throw new Error("FULL_ACCESS_ACK_REQUIRED");
      if (reset !== undefined && typeof reset !== "boolean") throw new Error("Invalid session reset flag");
      const result = await chats.store.patchOptions(input);
      if (reset === true) resetSessionEffective?.(input.chatId);
      chats.publishRecord(result);
      return { agent: result.agent, agentRevision: result.agentRevision, chatRecordRevision: result.chatRecordRevision, options: result.options };
    }))
    .roles("main")
    .handle(SETTINGS_CHANNEL.rememberChatDefaults, (options) => rememberChatDefaultsFor(store, options, catalog()));
  /* 变更广播是 renderer rebase 的前提：没有它，外部写入永远到不了
     renderer，后续 patch 全部基于陈旧基线计算。 */
  const unwatch = store.onChanged((envelope) => {
    if (!window.isDestroyed()) {
      window.webContents.send(SETTINGS_CHANNEL.changed, envelope);
    }
    // App windows read the same envelope for their composer, so they hear its changes too.
    windowRegistry.publish(SETTINGS_CHANNEL.changed, envelope, (record) => record.role === "app-window");
  });
  const unwatchHome = chatHomes.onStatus(status => {
    if (!window.isDestroyed()) window.webContents.send(SETTINGS_CHANNEL.chatHomeChanged, status);
  });
  window.once("closed", () => {
    unwatch();
    unwatchHome();
  });
}
