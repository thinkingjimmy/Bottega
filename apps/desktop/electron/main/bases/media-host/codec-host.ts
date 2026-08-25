/**
 * [INPUT]: Depends on Node child_process/path, shared attachment, limitations, Gallery header parser and codec framing; Receiving incredible image bytes
 * [OUTPUT]: Provides single-parallel, borderline queues, independent process groups, convergence seatbelts, V8 heap/RSS/pixel triple budget, overtime and the entire group TERM→KILL→reap
 * [POS]: The parent process supervisor for the codec bases/media-host; The image decoding only occurs in the locked version of the sharp subprocess, main only as a secondary header
 */

import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BASE_ATTACHMENT_BYTE_LIMIT,
} from "../../../../shared/bases/gallery-attachments";
import {
  BASE_ATTACHMENT_JOB_LIMIT,
  BASE_ATTACHMENT_QUEUE_BYTES,
} from "../../../../shared/bases/gallery-attachments";
import { parseAttachmentImageHeader } from "../../gallery/image-header";
import { decodeCodecFrames, encodeCodecFrames } from "./protocol";

const INPUT_LIMIT = 64 * 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;
// child 出流恒为单帧 ≤8MiB 产物 + terminal；64B 余量覆盖帧头。
const OUTPUT_WIRE_LIMIT = BASE_ATTACHMENT_BYTE_LIMIT + 64;
const TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 500;
const RSS_LIMIT_KIB = 768 * 1024;
const RSS_POLL_MS = 50;
const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 3;
const V8_HEAP_LIMIT_MIB = 192;

type CodecSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams;

export type ImageCodecHostOptions = {
  executable?: string;
  entry?: string;
  spawnProcess?: CodecSpawn;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
};

export class ImageCodecHost {
  private tail = Promise.resolve();
  private queued = 0;
  private queuedBytes = 0;
  private crashes: number[] = [];

  constructor(private readonly options: ImageCodecHostOptions = {}) {}

  normalize(bytes: Buffer, signal?: AbortSignal) {
    if (!bytes.length || bytes.length > INPUT_LIMIT) {
      return Promise.reject(codecError("BUDGET_EXCEEDED"));
    }
    if (!this.hasQueueCapacity(bytes.length)) {
      return Promise.reject(codecError("QUEUE_FULL"));
    }
    this.queued += 1;
    this.queuedBytes += bytes.length;
    const task = this.tail.then(() => this.run(bytes, signal));
    this.tail = task.then(() => undefined, () => undefined);
    return task.finally(() => {
      this.queued -= 1;
      this.queuedBytes -= bytes.length;
    });
  }

  private hasQueueCapacity(bytes: number) {
    return (
      this.queued < BASE_ATTACHMENT_JOB_LIMIT &&
      this.queuedBytes + bytes <= BASE_ATTACHMENT_QUEUE_BYTES
    );
  }

  private async run(bytes: Buffer, signal?: AbortSignal) {
    const now = Date.now();
    this.crashes = this.crashes.filter(
      (timestamp) => now - timestamp < CRASH_WINDOW_MS
    );
    if (this.crashes.length >= CRASH_LIMIT) {
      throw codecError("HOST_UNAVAILABLE");
    }
    try {
      const wire = await runCodecProcess(bytes, signal, this.options);
      const output = decodeOutput(wire);
      assertCodecOutput(output);
      return output;
    } catch (cause) {
      if (isHostCrash(cause)) this.crashes.push(Date.now());
      throw cause;
    }
  }
}

function decodeOutput(wire: Buffer) {
  try {
    return Buffer.concat(decodeCodecFrames(wire));
  } catch (cause) {
    throw codecError(
      "PROTOCOL",
      cause instanceof Error ? cause.message : String(cause)
    );
  }
}

async function runCodecProcess(
  bytes: Buffer,
  signal: AbortSignal | undefined,
  options: ImageCodecHostOptions
) {
  const executable = options.executable ?? process.execPath;
  const entry = canonical(
    options.entry ?? join(__dirname, "codec-host-entry.js")
  );
  const platform = options.platform ?? process.platform;
  const scratch = await mkdtemp(join(tmpdir(), "ai-chat-codec-"));
  const command = codecCommand(executable, entry, platform, scratch);
  const spawnProcess = options.spawnProcess ?? spawn;
  const grouped = platform !== "win32";
  try {
    const child = spawnProcess(command.executable, command.args, {
      cwd: scratch,
      env: codecEnvironment(scratch),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: grouped,
    });
    const input = encodeCodecFrames(chunk(bytes, 8 * 1024 * 1024));
    return await supervise(
      child,
      input,
      signal,
      options.timeoutMs ?? TIMEOUT_MS,
      grouped
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function codecCommand(
  executable: string,
  entry: string,
  platform: NodeJS.Platform,
  scratch: string
) {
  if (platform !== "darwin") {
    return {
      executable,
      args: [`--max-old-space-size=${V8_HEAP_LIMIT_MIB}`, entry],
    };
  }
  return {
    executable: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      codecSeatbeltProfile(executable, entry, scratch),
      executable,
      `--max-old-space-size=${V8_HEAP_LIMIT_MIB}`,
      entry,
    ],
  };
}

function codecEnvironment(scratch: string) {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    TMPDIR: scratch,
    XDG_CACHE_HOME: scratch,
    XDG_CONFIG_HOME: scratch,
    ELECTRON_RUN_AS_NODE: "1",
    SHARP_CONCURRENCY: "1",
    UV_THREADPOOL_SIZE: "1",
    VIPS_CONCURRENCY: "1",
  };
}

function supervise(
  child: ChildProcessWithoutNullStreams,
  input: Buffer,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  grouped: boolean
) {
  return new Promise<Buffer>((resolve, reject) => {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let failure: Error | undefined;
    const fail = (cause: Error) => {
      if (failure) return;
      failure = cause;
      terminate(child, grouped);
    };
    child.stdout.on("data", (part: Buffer) => {
      stdoutBytes += part.length;
      if (stdoutBytes > OUTPUT_WIRE_LIMIT) return fail(codecError("PROTOCOL"));
      stdout.push(part);
    });
    child.stderr.on("data", (part: Buffer) => {
      if (Buffer.byteLength(stderr) + part.length > STDERR_LIMIT) {
        return fail(codecError("PROTOCOL"));
      }
      stderr += part.toString("utf8");
    });
    child.once("error", (cause) => fail(hostCrash(cause.message)));
    child.once("close", (code, closeSignal) => {
      clearTimeout(timer);
      clearRssWatch();
      signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (code !== 0) {
        return reject(
          code === 2
            ? codecError("DECODE_FAILED", stderr.trim())
            : hostCrash(
                `codec host ${closeSignal ?? code ?? "closed"}${
                  stderr.trim() ? `: ${stderr.trim()}` : ""
                }`
              )
        );
      }
      resolve(Buffer.concat(stdout));
    });
    const abort = () => fail(codecError("CANCELLED"));
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => fail(codecError("TIMEOUT")), timeoutMs);
    const clearRssWatch = watchRss(child, fail, grouped);
    if (signal?.aborted) return abort();
    // 子进程吃完 stdin 前死亡（watchdog/timeout/启动即崩）会触发 EPIPE；
    // 不接住会以 stream error 逃逸成 uncaughtException 炸掉 main。
    child.stdin.on("error", (cause) => fail(hostCrash(cause.message)));
    child.stdin.end(input);
  });
}

function watchRss(
  child: ChildProcessWithoutNullStreams,
  fail: (cause: Error) => void,
  grouped: boolean
) {
  let reading = false;
  const timer = setInterval(() => {
    if (!child.pid || reading) return;
    reading = true;
    try {
      execFile(
        "/bin/ps",
        grouped
          ? ["-o", "rss=", "-g", String(child.pid)]
          : ["-o", "rss=", "-p", String(child.pid)],
        { timeout: RSS_POLL_MS, maxBuffer: 16_384 },
        (cause, stdout) => {
          reading = false;
          if (cause || child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          const rss = stdout
            .trim()
            .split(/\s+/)
            .reduce(
              (total, value) =>
                total + (Number.parseInt(value, 10) || 0),
              0
            );
          if (Number.isFinite(rss) && rss > RSS_LIMIT_KIB) {
            fail(codecError("BUDGET_EXCEEDED"));
          }
        }
      );
    } catch {
      reading = false;
    }
  }, RSS_POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

function terminate(
  child: ChildProcessWithoutNullStreams,
  grouped: boolean
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalProcess(child, "SIGTERM", grouped);
  const kill = setTimeout(
    () => signalProcess(child, "SIGKILL", grouped),
    KILL_GRACE_MS
  );
  child.once("close", () => clearTimeout(kill));
}

function signalProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
  grouped: boolean
) {
  if (grouped && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // 子进程可能已退出或测试 double 没有真实进程组；退回直接信号。
    }
  }
  child.kill(signal);
}

function assertCodecOutput(output: Buffer) {
  if (!output.length || output.length > BASE_ATTACHMENT_BYTE_LIMIT) {
    throw codecError("BUDGET_EXCEEDED");
  }
  parseAttachmentImageHeader(output.subarray(0, 512 * 1024));
}

function chunk(bytes: Buffer, size: number) {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
  }
  return chunks;
}

function codecError(code: string, detail?: string) {
  return Object.assign(new Error(detail ? `${code}: ${detail}` : code), {
    code,
  });
}

function hostCrash(message: string) {
  return Object.assign(new Error(message), {
    code: "HOST_CRASH",
    hostCrash: true,
  });
}

function isHostCrash(cause: unknown) {
  return Boolean(
    cause &&
      typeof cause === "object" &&
      "hostCrash" in cause &&
      cause.hostCrash === true
  );
}

export function codecSeatbeltProfile(
  executable: string,
  entry: string,
  scratch: string
) {
  const entryRoot = canonical(dirname(entry));
  const moduleRoot = nodeModulesRoot();
  // 打包后 entry/moduleRoot 是 asar 虚拟路径，内核按真实路径过滤：
  // 必须显式放行 app bundle Contents（含 app.asar 与 unpacked native）。
  const bundleRoot = bundleContentsRoot(executable);
  const resourcesRoot =
    typeof process.resourcesPath === "string" && process.resourcesPath
      ? canonical(process.resourcesPath)
      : undefined;
  const roots = [
    "/Library",
    "/System",
    "/bin",
    "/private/etc",
    "/private/var/db",
    "/private/var/run",
    "/sbin",
    "/usr",
    canonical(executable),
    entryRoot,
    ...(moduleRoot ? [moduleRoot] : []),
    ...(bundleRoot ? [bundleRoot] : []),
    ...(resourcesRoot ? [resourcesRoot] : []),
    canonical(scratch),
  ];
  const pathFilters = [...new Set(roots)]
    .map((path) => `(subpath ${sbpl(path)})`)
    .concat(
      ["/", "/dev/null", "/dev/random", "/dev/urandom", "/dev/zero"].map(
        (path) => `(literal ${sbpl(path)})`
      )
    )
    .join(" ");
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(deny network*)",
    "(deny process-fork)",
    "(deny process-info*)",
    "(allow process-info* (target self))",
    `(allow process-exec (literal ${sbpl(canonical(executable))}))`,
    "(allow file-read-metadata)",
    `(allow file-read* ${pathFilters})`,
    `(allow file-map-executable ${pathFilters})`,
    `(allow file-write* (subpath ${sbpl(
      canonical(scratch)
    )}) (literal ${sbpl("/dev/null")}))`,
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow ipc-posix*)",
  ].join("\n");
}

function bundleContentsRoot(executable: string) {
  const real = canonical(executable);
  const index = real.indexOf(".app/Contents/");
  return index < 0
    ? undefined
    : real.slice(0, index + ".app/Contents".length);
}

function nodeModulesRoot() {
  const marker = `${join("node_modules", "")}`;
  try {
    const sharpEntry = createRequire(__filename).resolve("sharp");
    const index = sharpEntry.indexOf(marker);
    return index < 0
      ? undefined
      : canonical(sharpEntry.slice(0, index + marker.length));
  } catch {
    return undefined;
  }
}

function canonical(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function sbpl(value: string) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}
