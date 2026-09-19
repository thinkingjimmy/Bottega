/**
 * [INPUT]: Depends on shell-free executable discovery, platform PATH/environment facts, the shared RUNTIME_TTL_MS freshness window and cancellable runtime/version probes
 * [OUTPUT]: Provides runtime candidates, version validation, login-shell PATH cache expiry for explicit rechecks, and exact OS launch/crash classification without interpreting network failures as startup failures.
 * [POS]: The backends are found when running the kernel; The lifecycle of the asynchronous process is called by its Runtime Registry flight unified with the canceled and drained
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { RUNTIME_TTL_MS } from "../../../shared/agent-availability/types";
import type { AgentRuntime } from "./types";
import { environmentValue, findExecutable, platformPathEnvironment } from "../custody/executable-path";

const SHELL_PROBE_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

async function commandPathAsync(
  command: string,
  envPath = environmentValue(process.env, "PATH") ?? "",
  signal?: AbortSignal
) {
  return findExecutable(command, { ...platformPathEnvironment(process.env), PATH: envPath }, signal);
}

/* ── One login shell per launch, not one per backend ──────────────────────
 * `zsh -ilc` runs the user's whole rc chain: 150-230 ms each, and four backends
 * probe in parallel at startup while two more re-probe after the window shows.
 * Six identical spawns produce one identical PATH, so callers share a single
 * flight and then its result for RUNTIME_TTL_MS — the same freshness window the
 * registry already applies to the runtimes derived from it.
 *
 * Cancellation stays honest in both directions: a caller that aborts stops
 * waiting immediately but does not kill a shell its peers still need, and the
 * shell is only killed once the last waiter is gone. A rejected flight is never
 * cached, so a broken rc file is retried rather than remembered.
 * ───────────────────────────────────────────────────────────────────────── */
type LoginShellFlight = {
  shell: string;
  waiters: number;
  controller: AbortController;
  promise: Promise<string | undefined>;
};

let loginShellFlight: LoginShellFlight | undefined;
let loginShellCache:
  | Readonly<{ shell: string; value: string | undefined; expiresAt: number }>
  | undefined;

function loginShellCommand() {
  return process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
}

async function spawnLoginShellPath(shell: string, signal: AbortSignal) {
  const { stdout } = await execFileAsync(shell, ["-ilc", "/usr/bin/env -0"], {
    encoding: "utf8",
    timeout: SHELL_PROBE_TIMEOUT_MS,
    maxBuffer: 256 * 1024,
    signal,
  });
  return String(stdout)
    .split("\0")
    .map((entry) => entry.slice(entry.lastIndexOf("\n") + 1))
    .find((entry) => entry.startsWith("PATH="))
    ?.slice(5);
}

function startLoginShellFlight(shell: string) {
  const controller = new AbortController();
  const flight = { shell, waiters: 0, controller } as LoginShellFlight;
  flight.promise = spawnLoginShellPath(shell, controller.signal)
    .then((value) => {
      loginShellCache = { shell, value, expiresAt: Date.now() + RUNTIME_TTL_MS };
      return value;
    })
    .finally(() => {
      if (loginShellFlight === flight) loginShellFlight = undefined;
    });
  // An abandoned flight must not surface as an unhandled rejection.
  flight.promise.catch(() => undefined);
  loginShellFlight = flight;
  return flight;
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A user-initiated recheck means "I changed my shell environment": drop the cached PATH, keep any in-flight probe. */
export function expireLoginShellPath() {
  loginShellCache = undefined;
}

async function loginShellPathAsync(signal?: AbortSignal) {
  if (process.platform === "win32") return undefined;
  signal?.throwIfAborted();
  const shell = loginShellCommand();
  const cached = loginShellCache;
  if (cached?.shell === shell && cached.expiresAt > Date.now()) return cached.value;
  const flight =
    loginShellFlight?.shell === shell ? loginShellFlight : startLoginShellFlight(shell);
  flight.waiters += 1;
  try {
    return await (signal ? untilAborted(flight.promise, signal) : flight.promise);
  } finally {
    flight.waiters -= 1;
    if (flight.waiters === 0 && loginShellFlight === flight) {
      /* Retire it before killing the shell, so a caller arriving during the
         teardown starts a fresh flight instead of inheriting the cancellation. */
      loginShellFlight = undefined;
      flight.controller.abort();
    }
  }
}

export function commonCommandPaths(command: string) {
  if (process.platform === "win32") {
    const local = environmentValue(process.env, "LOCALAPPDATA");
    const roaming = environmentValue(process.env, "APPDATA");
    return [join(homedir(), ".local/bin", `${command}.exe`),
      ...(local ? [join(local, "Microsoft/WinGet/Links", `${command}.exe`)] : []),
      ...(roaming ? [join(roaming, "npm", `${command}.exe`)] : [])];
  }
  return [
    join(homedir(), "Library/pnpm", command),
    join(homedir(), ".local/bin", command),
    join(homedir(), ".npm-global/bin", command),
    join(homedir(), ".bun/bin", command),
    join(homedir(), ".local/share/pnpm", command),
    join("/opt/homebrew/bin", command),
    join("/usr/local/bin", command),
  ];
}

/**
 * 只负责发现，不在这里猜哪个版本可用。Registry 会按本顺序逐个执行
 * version/identity/最低版本校验，直到找到第一份真正可启动的 runtime。
 */
export async function probeRuntimeCandidatesAsync(options: {
  command: string;
  commonPaths?: string[];
  signal?: AbortSignal;
}): Promise<AgentRuntime[]> {
  const candidates: AgentRuntime[] = [];
  const seen = new Set<string>();
  const append = (runtime: AgentRuntime | undefined) => {
    if (!runtime) return;
    const key = `${runtime.executable}\0${runtime.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(runtime);
  };
  options.signal?.throwIfAborted();
  try {
    const executable = await commandPathAsync(
      options.command,
      environmentValue(process.env, "PATH") ?? "",
      options.signal
    );
    if (executable) {
      append({ executable, path: environmentValue(process.env, "PATH") ?? "" });
    }
  } catch {
    options.signal?.throwIfAborted();
    // GUI PATH 不含命令时继续登录 shell。
  }
  try {
    const path = await loginShellPathAsync(options.signal);
    const executable = path
      ? await commandPathAsync(options.command, path, options.signal)
      : undefined;
    if (executable && path) append({ executable, path });
  } catch {
    options.signal?.throwIfAborted();
    // shell 配置不可用时继续常见路径。
  }
  for (
    const executable of
    options.commonPaths ?? commonCommandPaths(options.command)
  ) {
    const path = [dirname(executable), environmentValue(process.env, "PATH")]
      .filter(Boolean)
      .join(delimiter);
    try {
      const canonical = await commandPathAsync(executable, path, options.signal);
      if (canonical) append({ executable: canonical, path });
    } catch {
      options.signal?.throwIfAborted();
      // 当前候选不可执行，继续下一项。
    }
  }
  return candidates;
}

/** Only OS launch errors and crash signals prove an unusable process. */
export function isProcessStartupFailure(cause: unknown) {
  const error = cause as { code?: unknown; signal?: unknown; killed?: boolean } | null;
  return ["ENOENT", "EACCES", "ENOEXEC"].includes(String(error?.code)) ||
    (!error?.killed && ["SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS"].includes(String(error?.signal)));
}

export async function runtimeVersionAsync(
  runtime: AgentRuntime,
  args: string[] = ["--version"],
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = sanitizedProcessEnvironment(runtime.path)
) {
  try {
    const { stdout } = await execFileAsync(runtime.executable, args, {
      encoding: "utf8",
      env,
      timeout: VERSION_PROBE_TIMEOUT_MS,
      signal,
    });
    return normalizeCliVersion(String(stdout).trim());
  } catch (cause) {
    signal?.throwIfAborted();
    if (isProcessStartupFailure(cause)) throw cause;
    return undefined;
  }
}

const VERSION_PATTERN =
  /(?:^|[^0-9])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/;

export function normalizeCliVersion(value: string | undefined) {
  return value?.match(VERSION_PATTERN)?.[1];
}

/* 缺席即 fail-closed：没有真机取证的后端根本不进这张表，
   于是"某后端永不解锁"不需要任何分支去表达。 */
const SECTION_MCP_MINIMUM: Partial<
  Record<AgentBackendId, readonly number[]>
> = {
  codex: [0, 144, 4],
  /* 曾经写 2.1.22。那是个真实版本，但**低于 descriptor 的 2.1.216**——于是
     这条闸门对 claude 永远不会触发：能进产品的运行时必然已越过它，闸门在
     为一个产品根本不运行的版本作证（08-07 Review F10）。改挂真正在产品内
     跑通内置工具的那次取证：2.1.220 六环全通（verified-capabilities
     2026-08-01 行）。2.1.216–2.1.219 因此正确地落回 none。 */
  claude: [2, 1, 220],
  /* 0.29.2 → 0.39.0（2026-08-27 上调）。史实：kimi **0.37.0 引入**的
     `acpMcpServersToConfigRecord` 对无 `type` 的条目直接 throw
     「does not declare a runtime identity」，而 ACP v1 正典里 stdio 变体
     本就靠**没有 `type`**识别（SDK 1.3.0 `McpServerStdio` 无此字段）⇒
     **0.37.0–0.38.x 是坏窗口**：带内置 MCP 的 `session/new` 全数 -32603，
     产品内置工具面在 kimi 上整段不可用。上游 PR #3183 在 **0.39.0 修复**
     （补回 stdio 分支并自填 `runtime_id:"local"`），本机 0.39.0 深握手
     `builtinMcpReady=55ms` 实测转绿。
     **不做坏窗口区间闸**：产品未发布、无真实用户，零迁移哲学下把下界抬到
     已验证版本即可——区间闸是为存量用户写的分支，这里没有存量用户。 */
  kimi: [0, 39, 0],
};

function versionParts(value: string | undefined) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value ?? "");
  return match
    ? ([Number(match[1]), Number(match[2]), Number(match[3])] as const)
    : undefined;
}

function atLeast(
  current: readonly number[] | undefined,
  minimum: readonly number[]
) {
  if (!current) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] ?? 0) > minimum[index]!) return true;
    if ((current[index] ?? 0) < minimum[index]!) return false;
  }
  return true;
}

/**
 * oracle 矩阵：未被本机实测证明的版本/后端一律 fail-closed。
 * kimi 0.39.0 于 2026-08-27 真机取证解锁（深握手 builtinMcpReady 转绿）；0.29.2 的旧下界因
 * 0.37.0–0.38.x 的上游 stdio MCP 坏窗口作废，详见常量上方注释与真值账同日行。
 * opencode 未进表 ⇒ 恒 none（延后账本 L7）。
 */
export function builtinToolsForVersion(
  backend: AgentBackendId,
  version: string | undefined
) {
  const minimum = SECTION_MCP_MINIMUM[backend];
  return minimum && atLeast(versionParts(version), minimum)
    ? ("mutate" as const)
    : ("none" as const);
}

export function isVersionNewer(
  latestValue: string | undefined,
  currentValue: string | undefined
) {
  const latest = normalizeCliVersion(latestValue);
  const current = normalizeCliVersion(currentValue);
  if (!latest || !current) return false;
  const [latestCore, latestPre] = latest.split("-", 2);
  const [currentCore, currentPre] = current.split("-", 2);
  const latestParts = latestCore.split(".").map(Number);
  const currentParts = currentCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (latestParts[index] !== currentParts[index]) {
      return latestParts[index] > currentParts[index];
    }
  }
  if (latestPre === currentPre) return false;
  if (latestPre === undefined) return true;
  if (currentPre === undefined) return false;
  return latestPre.localeCompare(currentPre, "en", { numeric: true }) > 0;
}

export function runtimeVersionAtLeast(
  currentValue: string | undefined,
  minimumValue: string
) {
  const current = normalizeCliVersion(currentValue);
  const minimum = normalizeCliVersion(minimumValue);
  if (!current || !minimum) return false;
  return current === minimum || isVersionNewer(current, minimum);
}

export function sanitizedProcessEnvironment(
  pathValue = environmentValue(process.env, "PATH"),
  source: NodeJS.ProcessEnv = process.env
) {
  return {
    ...platformPathEnvironment(source),
    HOME: source.HOME ?? environmentValue(source, "USERPROFILE"),
    PATH: pathValue ?? (process.platform === "win32" ? "" : "/usr/bin:/bin:/usr/sbin:/sbin"),
    USER: source.USER,
    SHELL: source.SHELL,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    TMPDIR: source.TMPDIR,
  } satisfies NodeJS.ProcessEnv;
}
