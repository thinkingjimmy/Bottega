/**
 * [INPUT]: Depends on Memory-client and shared memory status/description/running time contract
 * [OUTPUT]: Provides module-level memoryStore: state, per-provider revision reducer, version checking instantaneous, health/upload, configuration/version switching and destructive capabilities
 * [POS]: Settings › Memory's renderer owner; View Unloaded Not Lost, Main Drive is Running Fact
 */

import type {
  MemoryAttentionAction,
  MemoryConfigPanel,
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryConsentAuthority,
  MemoryConsentPreview,
  MemoryConsentReason,
  MemoryDestructiveAuthority,
  MemoryDestructiveOperation,
  MemoryProviderDescriptor,
  MemoryRuntimeRendererCommand,
  MemoryRuntimeConfigAuthority,
  MemoryRuntimeConfigPreview,
  MemoryRuntimeSnapshot,
  MemoryStatusSnapshot,
} from "../../shared/memory-ipc";
import type { MemorySharingMode } from "../../shared/settings-ipc";
import { acceptMemoryRuntimeSnapshot } from "../../shared/memory-ipc";
import { errorMessage } from "@/lib/errors";
import {
  getMemoryStatus,
  checkMemoryRuntimeUpdates,
  listMemoryConfigPanels,
  listMemoryProviders,
  listMemoryRuntimeVersions,
  previewMemoryConsent,
  refreshMemoryHealth,
  refreshMemoryRuntimeState,
  previewMemoryRuntimeConfig,
  previewMemoryRuntimeConfigIssue,
  resolveMemoryRuntimeConfigIssue,
  resolveMemoryAttention,
  consumeMemoryDestructiveAuthority,
  requestMemoryDestructiveAuthority,
  requestMemoryRuntimeConfigAuthority,
  requestMemoryRuntimeConfigIssueAuthority,
  requestMemoryConsentAuthority,
  runMemoryRuntimeOperation,
  subscribeMemoryRuntimeState,
  subscribeMemoryStatus,
  writeMemoryRuntimeConfig,
} from "@/lib/memory-client";

type Snapshot = {
  providers: MemoryProviderDescriptor[];
  panels: MemoryConfigPanel[];
  status: MemoryStatusSnapshot | null;
  runtimes: Record<string, MemoryRuntimeSnapshot>;
  loading: boolean;
  error: string;
  checkingUpdates: Record<string, boolean>;
};

const EMPTY: Snapshot = {
  providers: [],
  panels: [],
  status: null,
  runtimes: {},
  loading: false,
  error: "",
  checkingUpdates: {},
};

const listeners = new Set<() => void>();
let snapshot: Snapshot = EMPTY;
let loaded = false;
let unsubscribeStatus: (() => void) | null = null;
let unsubscribeRuntime: (() => void) | null = null;

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function run(
  operation: () => Promise<MemoryStatusSnapshot>,
  failure: string
) {
  publish({ ...snapshot, loading: true, error: "" });
  try {
    const status = await operation();
    publish({ ...snapshot, status, loading: false, error: "" });
  } catch (cause) {
    publish({
      ...snapshot,
      loading: false,
      error: errorMessage(cause, failure),
    });
  }
}

async function runRuntime(
  operation: () => Promise<MemoryRuntimeSnapshot>,
  failure: string
) {
  try {
    const runtime = await operation();
    const current = snapshot.runtimes[runtime.providerId];
    if (!acceptMemoryRuntimeSnapshot(current, runtime)) return true;
    publish({
      ...snapshot,
      runtimes: { ...snapshot.runtimes, [runtime.providerId]: runtime },
      error: "",
    });
    return true;
  } catch (cause) {
    publish({ ...snapshot, error: errorMessage(cause, failure) });
    return false;
  }
}

export const memoryStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
  ensureLoaded() {
    if (loaded) return;
    loaded = true;
    unsubscribeStatus = subscribeMemoryStatus((status) =>
      publish({ ...snapshot, status, loading: false, error: "" })
    );
    unsubscribeRuntime = subscribeMemoryRuntimeState((runtime) => {
      const current = snapshot.runtimes[runtime.providerId];
      if (!acceptMemoryRuntimeSnapshot(current, runtime)) return;
      publish({
        ...snapshot,
        runtimes: { ...snapshot.runtimes, [runtime.providerId]: runtime },
      });
    });
    void Promise.all([listMemoryProviders(), listMemoryConfigPanels()])
      .then(([providers, panels]) => {
        publish({ ...snapshot, providers, panels });
        /* descriptor 驱动：有哪些托管运行时要探测，由注册表说了算。 */
        for (const descriptor of providers) {
          if (descriptor.managed) {
            void memoryStore.recheckRuntime(descriptor.id);
            void memoryStore.checkUpdates(descriptor.id, false);
          }
        }
      })
      .catch((cause) =>
        publish({
          ...snapshot,
          error: errorMessage(cause, "Memory provider 列表读取失败"),
        })
      );
    void run(getMemoryStatus, "Memory 状态读取失败");
  },
  refresh() {
    void run(refreshMemoryHealth, "Memory 健康检查失败");
  },
  async previewConsent(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode
  ): Promise<MemoryConsentPreview> {
    try {
      return await previewMemoryConsent(
        providerId,
        includeHistory,
        reason,
        sharingMode
      );
    } catch (cause) {
      /* 失败必须落 store error：调用方的 Promise.all 会整体吞掉，
         否则按钮点了没反应且界面零解释。 */
      publish({
        ...snapshot,
        loading: false,
        error: errorMessage(cause, "Memory 历史预览失败"),
      });
      throw cause;
    }
  },
  requestConsentAuthority(
    providerId: string,
    includeHistory: boolean,
    reason: MemoryConsentReason,
    sharingMode: MemorySharingMode,
    previewDigest: string
  ): Promise<MemoryConsentAuthority> {
    return requestMemoryConsentAuthority(
      providerId,
      includeHistory,
      reason,
      sharingMode,
      previewDigest
    );
  },
  resolve(id: string, action: MemoryAttentionAction) {
    void run(() => resolveMemoryAttention(id, action), "Memory 挂起处置失败");
  },
  recheckRuntime(providerId: string) {
    return runRuntime(
      () => refreshMemoryRuntimeState(providerId),
      "Memory 运行时状态读取失败"
    );
  },
  resolveConfigIssue(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    authorityToken?: string
  ) {
    return runRuntime(
      () => resolveMemoryRuntimeConfigIssue(issue, action, authorityToken),
      "Memory 配置问题处置失败"
    );
  },
  async previewConfigIssue(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction
  ) {
    try {
      return await previewMemoryRuntimeConfigIssue(issue, action);
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 手工配置目的地预览失败"),
      });
      throw cause;
    }
  },
  runRuntimeOperation(
    providerId: string,
    operation: MemoryRuntimeRendererCommand,
    version?: string
  ) {
    return runRuntime(
      () => runMemoryRuntimeOperation(providerId, operation, version),
      "Memory 运行时操作失败"
    );
  },
  async checkUpdates(providerId: string, force: boolean) {
    publish({
      ...snapshot,
      checkingUpdates: { ...snapshot.checkingUpdates, [providerId]: true },
    });
    try {
      return await runRuntime(
        () => checkMemoryRuntimeUpdates(providerId, force),
        "Memory 版本检查失败"
      );
    } finally {
      publish({
        ...snapshot,
        checkingUpdates: { ...snapshot.checkingUpdates, [providerId]: false },
      });
    }
  },
  listVersions(providerId: string) {
    return listMemoryRuntimeVersions(providerId);
  },
  async previewRuntimeConfig(
    providerId: string,
    values: Record<string, string>
  ): Promise<MemoryRuntimeConfigPreview> {
    try {
      return await previewMemoryRuntimeConfig(providerId, values);
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 配置目的地预览失败"),
      });
      throw cause;
    }
  },
  async requestRuntimeConfigAuthority(
    providerId: string,
    values: Record<string, string>,
    previewDigest: string
  ): Promise<MemoryRuntimeConfigAuthority> {
    try {
      return await requestMemoryRuntimeConfigAuthority(
        providerId,
        values,
        previewDigest
      );
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 配置目的地授权失败"),
      });
      throw cause;
    }
  },
  async requestConfigIssueAuthority(
    issue: MemoryConfigIssue,
    action: MemoryConfigIssueAction,
    previewDigest: string
  ): Promise<MemoryRuntimeConfigAuthority> {
    try {
      return await requestMemoryRuntimeConfigIssueAuthority(
        issue,
        action,
        previewDigest
      );
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 手工配置目的地授权失败"),
      });
      throw cause;
    }
  },
  writeRuntimeConfig(
    providerId: string,
    values: Record<string, string>,
    authorityToken?: string
  ) {
    return runRuntime(
      () => writeMemoryRuntimeConfig(providerId, values, authorityToken),
      "Memory 运行时配置提交失败"
    );
  },
  async requestDestructiveAuthority(
    providerId: string,
    operation: MemoryDestructiveOperation
  ): Promise<MemoryDestructiveAuthority | null> {
    try {
      return await requestMemoryDestructiveAuthority(providerId, operation);
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 破坏性操作授权失败"),
      });
      return null;
    }
  },
  async consumeDestructiveAuthority(token: string) {
    try {
      await consumeMemoryDestructiveAuthority(token);
      publish({ ...snapshot, error: "" });
    } catch (cause) {
      publish({
        ...snapshot,
        error: errorMessage(cause, "Memory 破坏性操作失败"),
      });
    }
  },
  resetForTests() {
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    unsubscribeRuntime?.();
    unsubscribeRuntime = null;
    loaded = false;
    snapshot = EMPTY;
  },
};
