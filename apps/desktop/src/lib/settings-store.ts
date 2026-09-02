/**
 * [INPUT]: Depends on settings-client revision get/set/mutateMemory/onChanged/Chat Home chooser/listModels, shared i18n runtime, and the renderer effective locale
 * [OUTPUT]: Provides settingsStore with testable factory owner by revision rebase, sequential mutation, Memory, special commands, per-backend Models with structured Agent failures, independent epoch and useSyncExternalStore
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
import { errorMessage } from "./errors";
import { effectiveLocale } from "./i18n-locale";
import { translate } from "../../shared/i18n/runtime";
import {
  rendererAgentSurfaceFailure,
  type AgentSurfaceFailure,
} from "./agent-failure";
import {
  chooseChatHomesRoot,
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
};

export type SettingsMutation = RendererSettingsMutation;

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
};

export function createSettingsStoreOwner(
  dependencies: SettingsStoreDependencies
) {
  const listeners = new Set<() => void>();
  let snapshot: SettingsStoreSnapshot = {
    settings: null,
    modelsByBackend: {},
    modelsReadyByBackend: {},
    error: "",
    modelsErrorByBackend: {},
    chatHomesRootBusy: false,
    chatHomesRootError: "",
  };
  let settingsLoaded = false;
  let settingsLoading = false;
  let settingsEpoch = 0;
  const modelsLoaded = new Set<AgentBackendId>();
  const modelsLoading = new Set<AgentBackendId>();
  const modelEpochs = new Map<AgentBackendId, number>();
  const enqueueSettingsMutation = createSettingsMutationQueue(
    () => dependencies.read(),
    dependencies.write
  );
  const publish = (next: SettingsStoreSnapshot) => {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  /* main 的每次落盘都会广播：renderer 据此 rebase 基线并刷新快照，
     「外部改了设置但界面不知道」的窗口就此关闭。 */
  const unsubscribe = dependencies.subscribe((envelope) => {
    enqueueSettingsMutation.rebase(envelope);
    settingsLoaded = true;
    publish({ ...snapshot, settings: envelope.settings });
  });

  const loadSettings = (force: boolean) => {
    if (!force && (settingsLoaded || settingsLoading)) return;
    const epoch = ++settingsEpoch;
    settingsLoading = true;
    publish({ ...snapshot, error: "" });
    void dependencies.read().then(
      (envelope) => {
        if (epoch !== settingsEpoch) return;
        settingsLoaded = true;
        settingsLoading = false;
        enqueueSettingsMutation.rebase(envelope);
        publish({ ...snapshot, settings: envelope.settings, error: "" });
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

  return {
    subscribe: (listener: () => void) => {
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
    update: async (mutation: SettingsMutation, failure: string) => {
      publish({ ...snapshot, error: "" });
      try {
        const envelope = await enqueueSettingsMutation(mutation);
        settingsLoaded = true;
        publish({ ...snapshot, settings: envelope.settings, error: "" });
      } catch (cause) {
        publish({ ...snapshot, error: errorMessage(cause, failure) });
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
    dispose: () => unsubscribe(),
    chooseChatHomesRoot: async () => {
      if (snapshot.chatHomesRootBusy) return;
      publish({
        ...snapshot,
        chatHomesRootBusy: true,
        chatHomesRootError: "",
      });
      try {
        const selected = await dependencies.chooseRoot();
        if (selected) {
          const envelope = await dependencies.read();
          settingsLoaded = true;
          enqueueSettingsMutation.rebase(envelope);
          publish({ ...snapshot, settings: envelope.settings });
        }
      } catch (cause) {
        publish({
          ...snapshot,
          chatHomesRootError: errorMessage(
            cause,
            translate(
              effectiveLocale(),
              "settings.general.chatHomeChangeFailed"
            )
          ),
        });
      } finally {
        publish({ ...snapshot, chatHomesRootBusy: false });
      }
    },
  };
}

export const settingsStore = createSettingsStoreOwner({
  read: getSettings,
  write: setSettings,
  mutateMemory: mutateMemorySettings,
  subscribe: subscribeSettings,
  list: (backend) => listModels(backend, { kind: "default" }),
  chooseRoot: chooseChatHomesRoot,
});
