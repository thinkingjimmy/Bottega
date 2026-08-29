/**
 * [INPUT]: Depends on shared/memory-ipc and preload exposure window.memory
 * [OUTPUT]: Provides renderer calls for Memory descriptors, status/source observation, provider/revision-fenced version operations, configuration, destructive actions, and mandatory-code read-only downgrades
 * [POS]: The only output of the renderer's Memory IPC; Business view not directly reading window
 */

import type {
  MemoryAttentionAction,
  MemoryBridgeApi,
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryConfigPanel,
  MemoryDestructiveOperation,
  MemoryProviderDescriptor,
  MemoryRuntimeRendererCommand,
  MemoryRuntimeSnapshot,
  MemoryStatusSnapshot,
} from "../../shared/memory-ipc";

declare global {
  interface Window {
    memory?: MemoryBridgeApi;
  }
}

/* 浏览器降级快照保持中性：写死某家 provider 会让纯网页环境
   显示一个从未被选择过的后端。 */
const browserStatus: MemoryStatusSnapshot = {
  enabled: false,
  paused: false,
  provider: "",
  baseUrl: "",
  target: null,
  health: "unknown",
  healthIssue: null,
  lastCaptureAt: null,
  warning: null,
  recallWarning: null,
  runningVersion: null,
  recall: {
    usedTurns: 0,
    zeroTurns: 0,
    failedTurns: 0,
    lastAt: null,
    lastOutcome: null,
    lastCount: null,
  },
  observationScope: null,
  epoch: null,
  applyStatus: null,
  delivery: {
    pendingTurns: 0,
    inflightBatches: 0,
    deliveredTurns: 0,
    gapTurns: 0,
  },
  rebuild: null,
  attention: [],
};

const browserRuntime = (providerId: string): MemoryRuntimeSnapshot => ({
  providerId,
  revision: 0,
  supported: false,
  installed: false,
  serviceReachable: false,
  configured: false,
  phase: "idle",
  operation: null,
  operationId: null,
  step: null,
  stepIndex: 0,
  stepTotal: 0,
  operationStartedAt: null,
  transfer: null,
  log: [],
  error: null,
  configIssue: null,
  configModes: {},
  installedVersion: null,
  /* 降级常量必须把契约铺满，一个键都不许漏：漏掉的那个键在纯网页里
     是 undefined，于是「没有版本切换在跑」与「不知道」变成同一件事。 */
  versionChange: null,
  lockedVersion: null,
  latestVersion: null,
  latestCheckedAt: null,
  latestCheckError: null,
  latestCheckWarning: null,
  updateAvailable: false,
  versionCatalogSupported: false,
  versionSource: null,
  versionHistory: [],
  yankedVersions: [],
  versionMatch: null,
  instanceId: null,
  ownershipMarkerPresent: false,
  dataEpoch: null,
  providerDataInstanceId: null,
  installRoot: null,
  dataRoot: null,
});

export const listMemoryProviders = (): Promise<MemoryProviderDescriptor[]> =>
  window.memory?.providers() ?? Promise.resolve([]);

export const listMemoryConfigPanels = (): Promise<MemoryConfigPanel[]> =>
  window.memory?.configPanels() ?? Promise.resolve([]);

export const getMemoryStatus = () =>
  window.memory?.getStatus() ?? Promise.resolve(structuredClone(browserStatus));

export const refreshMemoryHealth = () =>
  window.memory?.refreshHealth() ??
  Promise.resolve(structuredClone(browserStatus));

export const fetchMemorySupplyStreams = () =>
  window.memory?.supplyStreams() ?? Promise.resolve({ state: "disabled" as const });

export const revealMemoryDataRoot = (providerId: string) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.revealDataRoot(providerId);
};

export const resolveMemoryAttention = (
  id: string,
  action: MemoryAttentionAction
) =>
  window.memory?.resolveAttention({ id, action }) ??
  Promise.resolve(structuredClone(browserStatus));

export const previewMemoryConsent = (
  providerId: string,
  includeHistory: boolean,
  reason: import("../../shared/memory-ipc").MemoryConsentReason,
  sharingMode: import("../../shared/settings-ipc").MemorySharingMode
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.previewConsent({
    providerId,
    includeHistory,
    reason,
    sharingMode,
  });
};

export const requestMemoryConsentAuthority = (
  providerId: string,
  includeHistory: boolean,
  reason: import("../../shared/memory-ipc").MemoryConsentReason,
  sharingMode: import("../../shared/settings-ipc").MemorySharingMode,
  previewDigest: string
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.requestConsentAuthority({
    providerId,
    includeHistory,
    reason,
    sharingMode,
    previewDigest,
  });
};

export const subscribeMemoryStatus = (
  listener: (status: MemoryStatusSnapshot) => void
) => window.memory?.onStatus(listener) ?? (() => {});

export const runMemoryRuntimeOperation = (
  providerId: string,
  operation: MemoryRuntimeRendererCommand,
  version?: string
) =>
  window.memory?.runRuntimeOperation({
    providerId,
    operation,
    ...(version ? { version } : {}),
  }) ??
  Promise.resolve(browserRuntime(providerId));

export const writeMemoryRuntimeConfig = (
  providerId: string,
  values: Record<string, string>,
  authorityToken?: string
) =>
  window.memory?.writeRuntimeConfig({
    providerId,
    values,
    ...(authorityToken ? { authorityToken } : {}),
  }) ??
  Promise.resolve(browserRuntime(providerId));

export const previewMemoryRuntimeConfig = (
  providerId: string,
  values: Record<string, string>
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.previewRuntimeConfig({
    providerId,
    mutation: { kind: "write", values },
  });
};

export const previewMemoryRuntimeConfigIssue = (
  issue: MemoryConfigIssue,
  action: MemoryConfigIssueAction
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.previewRuntimeConfig({
    providerId: issue.providerId,
    mutation: { kind: "resolve-issue", issue, action },
  });
};

export const requestMemoryRuntimeConfigAuthority = (
  providerId: string,
  values: Record<string, string>,
  previewDigest: string
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.requestRuntimeConfigAuthority({
    providerId,
    mutation: { kind: "write", values },
    previewDigest,
  });
};

export const requestMemoryRuntimeConfigIssueAuthority = (
  issue: MemoryConfigIssue,
  action: MemoryConfigIssueAction,
  previewDigest: string
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.requestRuntimeConfigAuthority({
    providerId: issue.providerId,
    mutation: { kind: "resolve-issue", issue, action },
    previewDigest,
  });
};

export const refreshMemoryRuntimeState = (providerId: string) =>
  window.memory?.refreshRuntimeState(providerId) ??
  Promise.resolve(browserRuntime(providerId));

export const checkMemoryRuntimeUpdates = (
  providerId: string,
  force: boolean
) => window.memory?.checkRuntimeUpdates({ providerId, force }) ??
  Promise.resolve(browserRuntime(providerId));

export const listMemoryRuntimeVersions = (providerId: string) =>
  window.memory?.listRuntimeVersions(providerId) ??
  Promise.resolve({ providerId, revision: 0, versions: [], yankedVersions: [] });

export const resolveMemoryRuntimeConfigIssue = (
  issue: MemoryConfigIssue,
  action: MemoryConfigIssueAction,
  authorityToken?: string
) =>
  window.memory?.resolveRuntimeConfigIssue({
    issue,
    action,
    ...(authorityToken ? { authorityToken } : {}),
  }) ??
  Promise.resolve(browserRuntime(issue.providerId));

export const subscribeMemoryRuntimeState = (
  listener: (state: MemoryRuntimeSnapshot) => void
) => window.memory?.onRuntimeState(listener) ?? (() => {});

export const requestMemoryDestructiveAuthority = (
  providerId: string,
  operation: MemoryDestructiveOperation
) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.requestDestructiveAuthority({ providerId, operation });
};

export const consumeMemoryDestructiveAuthority = (token: string) => {
  if (!window.memory) return Promise.reject(new Error("Memory bridge 不可用"));
  return window.memory.consumeDestructiveAuthority(token);
};
