/**
 * [INPUT]: Depends on Node fs/path/crypto, the pure serve-trigger core, apps/support `isContained`, and the caller-injected run/log/warn capabilities
 * [OUTPUT]: Provides createServeLoop plus root-identity capture, turn tokens, bounded trigger reads, ack write/clear, and the settled+dispose lifecycle
 * [POS]: The apps/runtime serve IO state machine; it pins root identity once, watches the ancestor chain for writes, and drives Agent turns from acks instead of re-resolving paths per event
 */

import { constants, type FSWatcher, watch } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  AppManifest,
  ServerAppManifest,
} from "../../../../shared/apps-ipc";
import { asError } from "../../errors";
import { isContained } from "../support";
import {
  consumeTokenBucket,
  contractFingerprint,
  createRetryState,
  createTokenBucket,
  debounceDueAt,
  decideWake,
  failRetry,
  noteDebounce,
  observeTokenBucket,
  SERVE_ACK_VERSION,
  type DebounceState,
  type ServeAck,
  type ServeToken,
  type TokenBucketState,
} from "./serve-trigger";

const MAX_TRIGGER_BYTES = 8 * 1024 * 1024;
const READ_RETRIES = 3;
const RECONCILIATION_MS = 30_000;
const WATCH_RETRY_MIN_MS = 1_000;
const WATCH_RETRY_MAX_MS = 30_000;
const HASH_CHUNK_BYTES = 64 * 1024;
const SERVE_HEALTHY_RESET_MS = 60_000;
const SERVE_CONSECUTIVE_FAILURE_LIMIT = 3;
const SERVE_RESTART_WINDOW_MS = 60 * 60_000;
const SERVE_RESTART_LIMIT = 5;
const ACK_KEYS = [
  "contractFingerprint",
  "sha256",
  "size",
  "version",
  "watchPath",
].sort();

type WatchHandle = Pick<FSWatcher, "close" | "on">;

export type ServeLoop = {
  settled: Promise<void>;
  dispose: () => void;
};

export type ServeLoopDependencies = {
  appId: string;
  userData: string;
  appDir: string;
  manifest: ServerAppManifest;
  runAgentTurn: () => Promise<unknown>;
  appendLog: (line: string) => Promise<void>;
  setWarning: (warning: string | null) => Promise<void>;
  now?: () => number;
  watchFactory?: (
    path: string,
    onChange: () => void
  ) => WatchHandle;
  reconciliationMs?: number;
  afterOpen?: (attempt: number, path: string, file: FileHandle) => Promise<void>;
};

type SafeLocation = {
  watchDir: string;
  targetPath: string;
  warning: string | null;
};

export type ServeRootIdentity = {
  dev: number;
  ino: number;
  realPath: string;
};

type SafeReadResult = {
  token: ServeToken | null;
  warning: string | null;
};

export const serveAckPath = (userData: string, appId: string) =>
  join(userData, "apps-state", `${appId}.serve-ack`);

export async function removeServeAck(userData: string, appId: string) {
  await rm(serveAckPath(userData, appId), { force: true });
}

export function hasServeContract(
  manifest: AppManifest
): manifest is ServerAppManifest & {
  serveAgentPrompt: string;
  serveTrigger: NonNullable<ServerAppManifest["serveTrigger"]>;
  agentRequirements: NonNullable<ServerAppManifest["agentRequirements"]>;
} {
  return Boolean(
    manifest.kind === "server" &&
    manifest.serveAgentPrompt &&
      manifest.serveTrigger &&
      manifest.agentRequirements
  );
}

export function createServeLoop(deps: ServeLoopDependencies): ServeLoop {
  let disposed = false;
  let releaseDispose!: () => void;
  const disposedSignal = new Promise<void>((resolvePromise) => {
    releaseDispose = resolvePromise;
  });
  let watcher: WatchHandle | null = null;
  let watchedDir: string | null = null;
  let reconciliationTimer: NodeJS.Timeout | null = null;
  let eventTimer: NodeJS.Timeout | null = null;
  let scheduledTimer: NodeJS.Timeout | null = null;
  let scheduledAt = Number.POSITIVE_INFINITY;
  let debounce: DebounceState | null = null;
  let pending = false;
  let pumpPromise: Promise<void> | null = null;
  let rootIdentity: ServeRootIdentity | null = null;
  let lastTokenKey: string | null = null;
  let bucket: TokenBucketState = createTokenBucket((deps.now ?? Date.now)());
  let retry = createRetryState();
  let watcherFailures = 0;
  let consecutiveFailures = 0;
  let lastFailureAt: number | null = null;
  let failureTimes: number[] = [];
  let halted = false;
  let lastWarning: string | null = null;
  const now = deps.now ?? Date.now;
  const watchFactory = deps.watchFactory ?? ((path, onChange) => {
    const handle = watch(path, { persistent: false }, onChange);
    return handle;
  });

  const setWarning = async (warning: string | null) => {
    const normalized = warning?.slice(0, 3_500) ?? null;
    if (normalized === lastWarning) return;
    lastWarning = normalized;
    await deps.setWarning(normalized);
  };

  const clearTimer = (timer: NodeJS.Timeout | null) => {
    if (timer) clearTimeout(timer);
  };

  const cleanup = () => {
    watcher?.close();
    watcher = null;
    watchedDir = null;
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reconciliationTimer = null;
    clearTimer(eventTimer);
    clearTimer(scheduledTimer);
    eventTimer = null;
    scheduledTimer = null;
    scheduledAt = Number.POSITIVE_INFINITY;
  };

  const queueAt = (at: number) => {
    if (disposed || at >= scheduledAt) return;
    clearTimer(scheduledTimer);
    scheduledAt = at;
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      scheduledAt = Number.POSITIVE_INFINITY;
      queueReconcile();
    }, Math.max(0, at - now()));
  };

  const queueReconcile = () => {
    if (disposed) return;
    pending = true;
    if (pumpPromise) return;
    pumpPromise = pump()
      .catch(async (cause) => {
        const message = `伺服状态检查失败，将等待下一次 reconciliation：${asError(cause).message}`;
        await deps.appendLog(`[agent] ${message}`).catch(() => undefined);
        await setWarning(message).catch(() => undefined);
      })
      .finally(() => {
        pumpPromise = null;
        if (pending && !disposed) queueReconcile();
      });
  };

  const onChange = () => {
    if (disposed) return;
    debounce = noteDebounce(debounce, now());
    clearTimer(eventTimer);
    eventTimer = setTimeout(() => {
      debounce = null;
      eventTimer = null;
      queueReconcile();
    }, Math.max(0, debounceDueAt(debounce) - now()));
  };

  const attachWatcher = async (location: SafeLocation) => {
    if (location.warning) {
      watcher?.close();
      watcher = null;
      watchedDir = null;
      await setWarning(location.warning);
      return;
    }
    if (disposed || watchedDir === location.watchDir) return;
    watcher?.close();
    watcher = null;
    watchedDir = location.watchDir;
    try {
      const rebuilding = watcherFailures > 0;
      const next = watchFactory(location.watchDir, onChange);
      next.on("error", (cause: Error) => {
        if (disposed || watcher !== next) return;
        next.close();
        watcher = null;
        watchedDir = null;
        watcherFailures += 1;
        const delay = Math.min(
          WATCH_RETRY_MAX_MS,
          WATCH_RETRY_MIN_MS * 2 ** (watcherFailures - 1)
        );
        void setWarning(`伺服触发监视失败，将自动重建：${cause.message}`);
        queueAt(now() + delay);
      });
      watcher = next;
      watcherFailures = 0;
      if (rebuilding) await setWarning(null);
    } catch (cause) {
      watcher = null;
      watchedDir = null;
      watcherFailures += 1;
      const delay = Math.min(
        WATCH_RETRY_MAX_MS,
        WATCH_RETRY_MIN_MS * 2 ** (watcherFailures - 1)
      );
      await setWarning(
        `伺服触发监视失败，将自动重建：${asError(cause).message}`
      );
      queueAt(now() + delay);
    }
  };

  const reconcile = async () => {
    if (disposed || halted || !deps.manifest.serveTrigger || !rootIdentity) return;
    const watchPath = deps.manifest.serveTrigger.watchPath;
    const location = await locateSafeLocation(
      deps.appDir,
      rootIdentity,
      watchPath
    );
    await attachWatcher(location);
    const read = location.warning
      ? { token: null, warning: location.warning }
      : await safeReadServeToken({
          appDir: deps.appDir,
          rootIdentity,
          watchPath,
          afterOpen: deps.afterOpen,
        });
    if (read.warning) {
      await setWarning(read.warning);
      return;
    }
    const token = read.token;
    const tokenKey = token ? `${token.sha256}:${token.size}` : null;
    const changed = tokenKey !== lastTokenKey;
    lastTokenKey = tokenKey;
    bucket = observeTokenBucket(bucket, now(), changed);
    if (!token) return;

    const delivery = await readDeliveryFingerprint(deps.userData, deps.appId);
    const fingerprint = contractFingerprint(
      {
        serveTrigger: deps.manifest.serveTrigger,
        serveAgentPrompt: deps.manifest.serveAgentPrompt,
        agentRequirements: deps.manifest.agentRequirements,
      },
      delivery
    );
    const ack = await readAck(serveAckPath(deps.userData, deps.appId));
    if (decideWake(token, ack, watchPath, fingerprint) === "skip") return;
    if (now() < retry.retryAt) {
      queueAt(retry.retryAt);
      return;
    }
    const consumed = consumeTokenBucket(bucket, now());
    bucket = consumed.state;
    if (!consumed.allowed) {
      if (consumed.escalated) {
        await setWarning("伺服触发持续高频变化，已进入节流等待");
      }
      queueAt(consumed.retryAt);
      return;
    }

    const turnStart = token;
    await deps.appendLog(
      `[agent] 触发变化，启动单轮 sha256=${turnStart.sha256.slice(0, 12)} size=${turnStart.size}`
    );
    try {
      await deps.runAgentTurn();
      if (disposed) {
        await deps
          .appendLog("[agent] 单轮在停止期间结束，不写入 ack")
          .catch(() => undefined);
        return;
      }
      retry = createRetryState();
      /* 「连续失败」计的是最近这一串，不是这个 App 一辈子的失败总数：离上次
         失败已经过了健康窗口，那一串就断了。真正的抖动由 1h 内 5 次的滚动
         预算兜底——把两者混成一个计数器，等于给每个 App 发三条命就永久停机。 */
      if (
        lastFailureAt !== null &&
        now() - lastFailureAt >= SERVE_HEALTHY_RESET_MS
      ) {
        consecutiveFailures = 0;
        lastFailureAt = null;
      }
      await writeAck(serveAckPath(deps.userData, deps.appId), {
        version: SERVE_ACK_VERSION,
        watchPath,
        sha256: turnStart.sha256,
        size: turnStart.size,
        contractFingerprint: fingerprint,
      });
      await setWarning(null);
      if (!disposed) pending = true;
    } catch (cause) {
      if (disposed) {
        await deps
          .appendLog("[agent] 单轮已取消，不写入 ack")
          .catch(() => undefined);
        return;
      }
      retry = failRetry(retry, now());
      consecutiveFailures += 1;
      lastFailureAt = now();
      failureTimes = failureTimes
        .filter((timestamp) => now() - timestamp < SERVE_RESTART_WINDOW_MS)
        .concat(now());
      const message = asError(cause).message;
      halted =
        consecutiveFailures >= SERVE_CONSECUTIVE_FAILURE_LIMIT ||
        failureTimes.length >= SERVE_RESTART_LIMIT;
      const warning = halted
        ? `halted：伺服重启预算耗尽（连续 ${consecutiveFailures} 次，1h 内 ${failureTimes.length} 次）；请在 UI 显式重启`
        : message;
      await deps.appendLog(
        halted
          ? `[agent] ${warning}：${message}`
          : `[agent] 单轮失败，将退避重试：${message}`
      );
      await setWarning(warning);
      if (halted) return;
      queueAt(retry.retryAt);
    }
  };

  async function pump() {
    while (pending && !disposed) {
      pending = false;
      await reconcile();
    }
  }

  const settled = (async () => {
    try {
      if (!hasServeContract(deps.manifest)) {
        await setWarning("伺服契约不完整，请重新安装此 App");
        return;
      }
      rootIdentity = await captureServeRootIdentity(deps.appDir);
      queueReconcile();
      reconciliationTimer = setInterval(
        queueReconcile,
        deps.reconciliationMs ?? RECONCILIATION_MS
      );
      reconciliationTimer.unref?.();
      await disposedSignal;
      await pumpPromise;
    } catch (cause) {
      await deps
        .appendLog(`[agent] 伺服循环启动失败：${asError(cause).message}`)
        .catch(() => undefined);
      await setWarning(asError(cause).message).catch(() => undefined);
    } finally {
      cleanup();
    }
  })();

  return {
    settled,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cleanup();
      releaseDispose();
    },
  };
}

export async function safeReadServeToken(input: {
  appDir: string;
  rootIdentity?: ServeRootIdentity;
  watchPath: string;
  afterOpen?: (attempt: number, path: string, file: FileHandle) => Promise<void>;
}): Promise<SafeReadResult> {
  const rootIdentity =
    input.rootIdentity ?? await captureServeRootIdentity(input.appDir);
  const targetPath = resolve(input.appDir, input.watchPath);
  for (let attempt = 1; attempt <= READ_RETRIES; attempt += 1) {
    let file: FileHandle | null = null;
    try {
      const rootWarning = await inspectRootIdentity(
        input.appDir,
        rootIdentity
      );
      if (rootWarning) return { token: null, warning: rootWarning };
      file = await open(
        targetPath,
        constants.O_RDONLY |
          constants.O_NONBLOCK |
          (constants.O_NOFOLLOW ?? 0)
      );
      const opened = await file.stat();
      if (!opened.isFile()) {
        return { token: null, warning: "伺服触发路径不是普通文件" };
      }
      if (opened.size > MAX_TRIGGER_BYTES) {
        return { token: null, warning: "伺服触发文件超过 8 MiB，已拒绝读取" };
      }
      await input.afterOpen?.(attempt, targetPath, file);
      const identity = await inspectTargetIdentity(
        input.appDir,
        rootIdentity,
        input.watchPath
      );
      if (identity.warning) return { token: null, warning: identity.warning };
      if (
        !identity.info ||
        opened.dev !== identity.info.dev ||
        opened.ino !== identity.info.ino
      ) {
        continue;
      }

      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
      let position = 0;
      while (true) {
        const { bytesRead } = await file.read(
          buffer,
          0,
          buffer.length,
          position
        );
        if (bytesRead === 0) break;
        position += bytesRead;
        if (position > MAX_TRIGGER_BYTES) {
          return { token: null, warning: "伺服触发文件超过 8 MiB，已拒绝读取" };
        }
        hash.update(buffer.subarray(0, bytesRead));
      }
      const finished = await file.stat();
      if (
        finished.dev !== opened.dev ||
        finished.ino !== opened.ino ||
        finished.size !== position
      ) {
        continue;
      }
      return {
        token: { sha256: hash.digest("hex"), size: position },
        warning: null,
      };
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException;
      if (error.code === "ENOENT") return { token: null, warning: null };
      if (error.code === "ELOOP") {
        return { token: null, warning: "伺服触发文件不得是符号链接" };
      }
      return {
        token: null,
        warning: `无法安全读取伺服触发文件：${asError(cause).message}`,
      };
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
  return {
    token: null,
    warning: "伺服触发文件在读取期间持续被替换，本周期已放弃",
  };
}

export async function captureServeRootIdentity(
  appDir: string
): Promise<ServeRootIdentity> {
  const before = await lstat(appDir);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error("App 根目录不是安全的真实目录");
  }
  const realPath = await realpath(appDir);
  const after = await lstat(appDir);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    throw new Error("App 根目录在身份采集期间发生变化");
  }
  return { dev: after.dev, ino: after.ino, realPath };
}

async function locateSafeLocation(
  appDir: string,
  rootIdentity: ServeRootIdentity,
  watchPath: string
): Promise<SafeLocation> {
  const rootWarning = await inspectRootIdentity(appDir, rootIdentity);
  if (rootWarning) {
    return {
      watchDir: appDir,
      targetPath: resolve(appDir, watchPath),
      warning: rootWarning,
    };
  }
  const segments = splitWatchPath(watchPath);
  let watchDir = appDir;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const candidate = join(appDir, ...segments.slice(0, index + 1));
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) {
        return {
          watchDir,
          targetPath: resolve(appDir, watchPath),
          warning: "伺服触发路径的目录链包含符号链接",
        };
      }
      if (!info.isDirectory()) {
        return {
          watchDir,
          targetPath: resolve(appDir, watchPath),
          warning: "伺服触发路径的中间节点不是目录",
        };
      }
      const candidateReal = await realpath(candidate);
      if (!isContained(rootIdentity.realPath, candidateReal)) {
        return {
          watchDir,
          targetPath: resolve(appDir, watchPath),
          warning: "伺服触发路径越出 App 根目录",
        };
      }
      watchDir = candidate;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") break;
      throw cause;
    }
  }
  return { watchDir, targetPath: resolve(appDir, watchPath), warning: null };
}

async function inspectTargetIdentity(
  appDir: string,
  rootIdentity: ServeRootIdentity,
  watchPath: string
) {
  const location = await locateSafeLocation(appDir, rootIdentity, watchPath);
  if (location.warning) return { info: null, warning: location.warning };
  try {
    const info = await lstat(location.targetPath);
    if (info.isSymbolicLink()) {
      return { info: null, warning: "伺服触发文件不得是符号链接" };
    }
    return { info, warning: null };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { info: null, warning: null };
    }
    throw cause;
  }
}

async function inspectRootIdentity(
  appDir: string,
  expected: ServeRootIdentity
) {
  try {
    const before = await lstat(appDir);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      before.dev !== expected.dev ||
      before.ino !== expected.ino
    ) {
      return "App 根目录身份已变化，已拒绝读取伺服触发文件";
    }
    const currentReal = await realpath(appDir);
    const after = await lstat(appDir);
    if (
      !after.isDirectory() ||
      after.isSymbolicLink() ||
      after.dev !== expected.dev ||
      after.ino !== expected.ino ||
      currentReal !== expected.realPath
    ) {
      return "App 根目录身份已变化，已拒绝读取伺服触发文件";
    }
    return null;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return "App 根目录已消失，已拒绝读取伺服触发文件";
    }
    throw cause;
  }
}

function splitWatchPath(watchPath: string) {
  const normalized = watchPath.split(/[\\/]+/).filter(Boolean);
  if (
    normalized.length === 0 ||
    isAbsolute(watchPath) ||
    normalized.includes("..")
  ) {
    throw new Error("serveTrigger.watchPath 不是安全相对路径");
  }
  return normalized;
}

async function readDeliveryFingerprint(userData: string, appId: string) {
  try {
    return await readFile(join(userData, "apps-state", `${appId}.fingerprint`), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw cause;
  }
}

async function readAck(path: string): Promise<ServeAck | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(ACK_KEYS)) {
      return null;
    }
    if (
      parsed.version !== SERVE_ACK_VERSION ||
      typeof parsed.watchPath !== "string" ||
      typeof parsed.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.sha256) ||
      typeof parsed.size !== "number" ||
      !Number.isSafeInteger(parsed.size) ||
      parsed.size < 0 ||
      typeof parsed.contractFingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.contractFingerprint)
    ) {
      return null;
    }
    return parsed as ServeAck;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT" || cause instanceof SyntaxError) {
      return null;
    }
    throw cause;
  }
}

async function writeAck(path: string, ack: ServeAck) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(ack)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
