/**
 * [INPUT]: Depends on Node crypto/fs/path, standard Fetch flow and bytes given by the caller/SHA256 true value
 * [OUTPUT]: Provides downloadToFile/writeFully: three-level overtime, flow limits, short-scripting, O_EXCL/NOFOLLOW staging, double-check, directory fsync positioning and three backsliding for instantaneous errors only
 * [POS]: The main/memory/runtime/managed security bytes are downloaded in the original language; Only deliver the authenticated files, not manage the provider lifecycle
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";

const HEADER_TIMEOUT_MS = 10_000;
const STALL_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [0, 300, 900] as const;

export type DownloadProgress = Readonly<{
  receivedBytes: number;
  totalBytes: number;
}>;

export type DownloadToFileOptions = {
  bytes: number;
  sha256: string;
  onProgress?: (progress: DownloadProgress) => void;
  fetcher?: typeof fetch;
  /** 仅供确定性测试缩短时间；生产调用不传。 */
  timeouts?: Partial<{
    headerMs: number;
    stallMs: number;
    totalMs: number;
  }>;
};

/* ============================================================
 * 重试只对「换个时刻可能不一样」的错误有意义：断流、超时、连接被拒。
 * 内容对不上规格（SHA/字节数）或 staging 身份被换掉，重试三次只是
 * 把同一个确定的坏结论慢速复读三遍——立刻上抛，让人看见真因。
 * ============================================================ */
class DeterministicDownloadFailure extends Error {}

export async function downloadToFile(
  url: string,
  destination: string,
  options: DownloadToFileOptions
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
    if (RETRY_DELAYS_MS[attempt]) await delay(RETRY_DELAYS_MS[attempt]!);
    try {
      await downloadOnce(url, destination, options);
      return;
    } catch (cause) {
      if (cause instanceof DeterministicDownloadFailure) throw cause;
      lastError = cause;
    }
  }
  throw lastError;
}

async function downloadOnce(
  url: string,
  destination: string,
  options: DownloadToFileOptions
) {
  const fetcher = options.fetcher ?? fetch;
  const headerMs = options.timeouts?.headerMs ?? HEADER_TIMEOUT_MS;
  const stallMs = options.timeouts?.stallMs ?? STALL_TIMEOUT_MS;
  const totalMs = options.timeouts?.totalMs ?? TOTAL_TIMEOUT_MS;
  const staging = `${destination}.${randomUUID()}.download`;
  const controller = new AbortController();
  const startedAt = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    handle = await open(
      staging,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_WRONLY,
      0o600
    );
    const response = await withTimeout(
      fetcher(url, { redirect: "follow", signal: controller.signal }),
      headerMs,
      "下载响应头超时",
      controller
    );
    if (!response.ok || !response.body) {
      throw new Error(`下载失败：HTTP ${response.status} ${url}`);
    }
    const reader = response.body.getReader();
    const digest = createHash("sha256");
    let receivedBytes = 0;
    for (;;) {
      const remaining = totalMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error("下载总时长超时");
      const timeoutMs = Math.min(stallMs, remaining);
      const timeoutMessage = remaining <= stallMs
        ? "下载总时长超时"
        : "下载超过 30 秒没有收到新字节";
      const chunk = await withTimeout(
        reader.read(),
        timeoutMs,
        timeoutMessage,
        controller
      );
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > options.bytes) {
        throw new Error(`下载字节超过规格上限 ${options.bytes}`);
      }
      digest.update(chunk.value);
      await writeFully(handle, chunk.value);
      options.onProgress?.({
        receivedBytes,
        totalBytes: options.bytes,
      });
    }
    const actualDigest = digest.digest("hex");
    if (receivedBytes !== options.bytes) {
      throw new DeterministicDownloadFailure(
        `下载字节数不符：期望 ${options.bytes}，实得 ${receivedBytes}`
      );
    }
    if (actualDigest !== options.sha256) {
      throw new DeterministicDownloadFailure(
        `下载 SHA256 不符：期望 ${options.sha256}，实得 ${actualDigest}`
      );
    }
    await handle.sync();
    const opened = await handle.stat();
    const named = await lstat(staging);
    if (
      !opened.isFile() ||
      !named.isFile() ||
      opened.dev !== named.dev ||
      opened.ino !== named.ino
    ) {
      throw new DeterministicDownloadFailure("下载 staging 身份在落位前发生变化");
    }
    await handle.close();
    handle = null;
    await rename(staging, destination);
    /* 文件内容已 fsync，但「这个名字指向它」还只在目录页缓存里；
       断电后留下的空目录项会让下次安装以为资产已就位。 */
    await syncDirectory(dirname(destination));
  } catch (cause) {
    controller.abort();
    await handle?.close().catch(() => undefined);
    await rm(staging, { force: true }).catch(() => undefined);
    throw cause;
  }
}

async function syncDirectory(directory: string) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeFully(
  handle: Pick<FileHandle, "write">,
  chunk: Uint8Array
) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(
      chunk,
      offset,
      chunk.byteLength - offset
    );
    if (bytesWritten <= 0) throw new Error("下载文件写入未取得进展");
    offset += bytesWritten;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  controller: AbortController
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      }
    );
  });
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
