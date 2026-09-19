/**
 * [INPUT]: Depends on settings-client revision get/set/mutateMemory/onChanged/Chat Home chooser/folder retry/listModels, the main-provided startup snapshot, shared i18n runtime, and the renderer effective locale
 * [OUTPUT]: Provides settingsStore seeded from the startup snapshot (no read on first use) with revision-rebased boolean mutation results and local/global error ownership, Memory commands, folder selection and dialog-free retry sharing one open path, change-only folder progress, and per-backend model snapshots
 * [POS]: General/Memory/Onboarding is set to the renderer as the sole owner; Domain and back end isolation to avoid slow requests, old responses and error contamination
 */

import type {
  AgentBackendId,
  BackendModelInfo,
} from "../../shared/agent-ipc";
import type {
  AppSettings,
  MemorySettingsMutation,
  RendererSettingsMutation,
  RendererSettingsPatch,
  SettingsEnvelope,
} from "../../shared/settings-ipc";
import { backendLabel } from "./agent-backends";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { effectiveLocale } from "./i18n-locale";
import { translate } from "../../shared/i18n/runtime";
import {
  rendererAgentSurfaceFailure,
  type AgentSurfaceFailure,
} from "./agent-failure";
import { readStartupSnapshot } from "../../shared/startup-snapshot";
import {
  chooseChatHomesRoot,
  retryLibrary,
  subscribeChatHomeStatus,
  getSettings,
  listModels,
  mutateMemorySettings,
  setSettings,
  subscribeSettings,
} from "./settings-client";

export type SettingsStoreSnapshot = {
  settings: AppSettings | null;
  modelsByBackend: Partial<Record<AgentBackendId, BackendModelInfo[]>>;
  modelsReadyByBackend: Partial<Record<AgentBackendId, boolean>>;
  /** settings 域错误；Memory 视图依赖此字段名与语义。 */
  error: string;
  modelsErrorByBackend: Partial<Record<AgentBackendId, AgentSurfaceFailure | null>>;
  chatHomesRootBusy: boolean;
  chatHomesRootError: string;
  folderProgress?: import("../../shared/settings-ipc").ChatHomeStatus["progress"];
};

export type SettingsMutation = RendererSettingsMutation;
export type SettingsUpdateOptions = { errorScope?: "global" | "local" };

/* ============================================================
 * 队列曾经缓存 canonical 且首写后再也不 read：外部写入永远到不了
 * renderer，之后每个 patch 都基于一份陈旧基线计算。
 *
 * 修法是 rebase：基线带 revision，广播来的更高 revision 直接顶掉
 * 它。函数式 mutation 因此总是看见最新的真相，而不是自己上一次
 * 写下的回声。
 * ============================================================ */
export function createSettingsMutationQueue(
  read: () => Promise<SettingsEnvelope>,
  write: (patch: RendererSettingsPatch) => Promise<SettingsEnvelope>
) {
  let tail = Promise.resolve();
  let canonical: SettingsEnvelope | null = null;
  const rebase = (envelope: SettingsEnvelope) => {
    if (!canonical || envelope.revision >= canonical.revision) {
      canonical = envelope;
    }
    return canonical;
  };
  const enqueue = (mutation: SettingsMutation) => {
    const task = tail.then(async () => {
      const current = canonical ?? rebase(await read());
      const patch =
        typeof mutation === "function"
          ? mutation(current.settings)
          : mutation;
      return rebase(await write(patch));
    });
    tail = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  };
  enqueue.rebase = rebase;
  return enqueue;
}

type SettingsStoreDependencies = {
  /** Main's envelope as of window creation; it makes the first render authoritative. */
  initial?: SettingsEnvelope | null;
  read: () => Promise<SettingsEnvelope>;
  write: (patch: RendererSettingsPatch) => Promise<SettingsEnvelope>;
  mutateMemory: (
    mutation: MemorySettingsMutation
  ) => Promise<SettingsEnvelope>;
  subscribe: (listener: (envelope: SettingsEnvelope) => void) => () => void;
  list: (
    backend: AgentBackendId
  ) => Promise<BackendModelInfo[]>;
  chooseRoot: () => Promise<unknown | null>;
  /** Reopens the configured folder; absent only in tests that never exercise the retry. */
  retryRoot?: () => Promise<unknown | null>;
  subscribeHome?: typeof subscribeChatHomeStatus;
};

type FolderProgress = SettingsStoreSnapshot["folderProgress"];
/* chatHomeChanged fires on every progress callback, and null -> null is the most
   common one: publishing a new snapshot without comparing would make all 15
   useSyncExternalStore consumers (including i18n and the setup provider)
   re-render the whole screen on every debounced write. */
const sameProgress = (left: FolderProgress, right: FolderProgress) => {
  const [a, b] = [left ?? null, right ?? null];
  if (!a || !b) return a === b;
  return a.phase === b.phase && a.completed === b.completed && a.total === b.total && a.failed === b.failed;
};

export function createSettingsStoreOwner(
  dependencies: SettingsStoreDependencies
) {
  const listeners = new Set<() => void>();
  const seeded = dependencies.initial ?? null;
  let snapshot: SettingsStoreSnapshot = {
    settings: seeded?.settings ?? null,
    modelsByBackend: {},
    modelsReadyByBackend: {},
    error: "",
    modelsErrorByBackend: {},
    chatHomesRootBusy: false,
    chatHomesRootError: "",
  };
  /* The startup snapshot is the same envelope `settings:get` would answer with, so
     it counts as loaded: the gate opens on the first render and no read is issued.
     Broadcasts still rebase it, and retrySettings still forces a real read. */
  let settingsLoaded = Boolean(seeded);
  let settingsLoading = false;
  let settingsEpoch = 0;
  const modelsLoaded = new Set<AgentBackendId>();
  const modelsLoading = new Set<AgentBackendId>();
  const modelEpochs = new Map<AgentBackendId, number>();
  const enqueueSettingsMutation = createSettingsMutationQueue(
    () => dependencies.read(),
    dependencies.write
  );
  if (seeded) enqueueSettingsMutation.rebase(seeded);
  const publish = (next: SettingsStoreSnapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  /* main 的每次落盘都会广播：renderer 据此 rebase 基线并刷新快照，
     「外部改了设置但界面不知道」的窗口就此关闭。订阅在第一个消费者
     到场时才建立，模块加载期不触碰 bridge。 */
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    dependencies.subscribe((envelope) => {
      const canonical = enqueueSettingsMutation.rebase(envelope);
      settingsLoaded = true;
      publish({ ...snapshot, settings: canonical.settings });
    });
    dependencies.subscribeHome?.(status => {
      const progress = status.progress ?? null;
      if (sameProgress(snapshot.folderProgress, progress)) return;
      publish({ ...snapshot, folderProgress: progress });
    });
  };

  const loadSettings = (force: boolean) => {
    start();
    if (!force && (settingsLoaded || settingsLoading)) return;
    const epoch = ++settingsEpoch;
    settingsLoading = true;
    publish({ ...snapshot, error: "" });
    void dependencies.read().then(
      (envelope) => {
        if (epoch !== settingsEpoch) return;
        settingsLoaded = true;
        settingsLoading = false;
        const canonical = enqueueSettingsMutation.rebase(envelope);
        publish({ ...snapshot, settings: canonical.settings, error: "" });
      },
      (cause) => {
        if (epoch !== settingsEpoch) return;
        settingsLoaded = false;
        settingsLoading = false;
        publish({
          ...snapshot,
          error: errorMessage(
            cause,
            translate(effectiveLocale(), "settings.general.settingsLoadFailed")
          ),
        });
      }
    );
  };

  const loadModels = (backend: AgentBackendId, force: boolean) => {
    if (
      !force &&
      (modelsLoaded.has(backend) || modelsLoading.has(backend))
    ) {
      return;
    }
    const epoch = (modelEpochs.get(backend) ?? 0) + 1;
    modelEpochs.set(backend, epoch);
    modelsLoading.add(backend);
    modelsLoaded.delete(backend);
    publish({
      ...snapshot,
      modelsReadyByBackend: {
        ...snapshot.modelsReadyByBackend,
        [backend]: false,
      },
      modelsErrorByBackend: {
        ...snapshot.modelsErrorByBackend,
        [backend]: null,
      },
    });
    void dependencies.list(backend).then(
      (models) => {
        if (modelEpochs.get(backend) !== epoch) return;
        modelsLoading.delete(backend);
        modelsLoaded.add(backend);
        publish({
          ...snapshot,
          modelsByBackend: {
            ...snapshot.modelsByBackend,
            [backend]: models,
          },
          modelsReadyByBackend: {
            ...snapshot.modelsReadyByBackend,
            [backend]: true,
          },
          modelsErrorByBackend: {
            ...snapshot.modelsErrorByBackend,
            [backend]: null,
          },
        });
      },
      (cause) => {
        if (modelEpochs.get(backend) !== epoch) return;
        modelsLoading.delete(backend);
        modelsLoaded.delete(backend);
        publish({
          ...snapshot,
          modelsReadyByBackend: {
            ...snapshot.modelsReadyByBackend,
            [backend]: false,
          },
          modelsErrorByBackend: {
            ...snapshot.modelsErrorByBackend,
            [backend]: rendererAgentSurfaceFailure(
              "service-unavailable",
              backendLabel(backend),
              cause,
              backend
            ),
          },
        });
      }
    );
  };

  const openFolder = async (open: () => Promise<unknown | null>): Promise<boolean> => {
    if (snapshot.chatHomesRootBusy) return false;
    publish({ ...snapshot, chatHomesRootBusy: true, chatHomesRootError: "" });
    try {
      const selected = await open();
      if (!selected) return false;
      const envelope = await dependencies.read();
      settingsLoaded = true;
      enqueueSettingsMutation.rebase(envelope);
      publish({ ...snapshot, settings: envelope.settings });
      return envelope.settings.chatHomeState === "ready";
    } catch (cause) {
      publish({
        ...snapshot,
        chatHomesRootError: errorMessage(
          cause,
          translate(effectiveLocale(), "settings.general.chatHomeChangeFailed")
        ),
      });
      return false;
    } finally {
      publish({ ...snapshot, chatHomesRootBusy: false });
    }
  };

  return {
    subscribe: (listener: () => void) => {
      start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    ensureLoaded: () => loadSettings(false),
    retrySettings: () => loadSettings(true),
    ensureModels: (backend: AgentBackendId) => loadModels(backend, false),
    retryModels: (backend: AgentBackendId) => loadModels(backend, true),
    update: async (
      mutation: SettingsMutation,
      failure: string,
      options: SettingsUpdateOptions = {}
    ): Promise<boolean> => {
      const globalError = options.errorScope !== "local";
      if (globalError) publish({ ...snapshot, error: "" });
      try {
        const envelope = await enqueueSettingsMutation(mutation);
        settingsLoaded = true;
        publish({ ...snapshot, settings: envelope.settings, ...(globalError ? { error: "" } : {}) });
        return true;
      } catch (cause) {
        if (globalError) publish({ ...snapshot, error: errorMessage(cause, failure) });
        return false;
      }
    },
    /* Memory 走专用命令而非通用 patch：三处 settingsStore.update({memory})
       正是「任何守护都能被绕过」的旧形状。 */
    mutateMemory: async (
      mutation: MemorySettingsMutation,
      failure: string
    ) => {
      publish({ ...snapshot, error: "" });
      try {
        const envelope = await dependencies.mutateMemory(mutation);
        settingsLoaded = true;
        enqueueSettingsMutation.rebase(envelope);
        publish({ ...snapshot, settings: envelope.settings, error: "" });
        return true;
      } catch (cause) {
        publish({ ...snapshot, error: errorMessage(cause, failure) });
        return false;
      }
    },
    chooseChatHomesRoot: () => openFolder(dependencies.chooseRoot),
    /* Two entry points into the same open flow: choosing a folder and reopening
       a configured one must share one busy/error/ready path, or retry grows a
       second state machine of its own. */
    retryLibrary: () =>
      openFolder(() => dependencies.retryRoot?.() ?? Promise.resolve(null)),
  };
}

export const settingsStore = createSettingsStoreOwner({
  initial: readStartupSnapshot()?.settings,
  read: getSettings,
  write: setSettings,
  mutateMemory: mutateMemorySettings,
  subscribe: subscribeSettings,
  list: (backend) => listModels(backend, { kind: "default" }),
  chooseRoot: chooseChatHomesRoot,
  retryRoot: retryLibrary,
  subscribeHome: subscribeChatHomeStatus,
});
