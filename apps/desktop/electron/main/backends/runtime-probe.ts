/**
 * [INPUT]: Depends on Node child_process/os/path/util, explicit command names and Registry flight AbortSignal
 * [OUTPUT]: Provides sequencing candidate listing, canceled and environmentally inserted asynchronous versions detection, specification versions, built-in tooling versions oracle, minimum version access restrictions and comparison of semantic updates
 * [POS]: The backends are found when running the kernel; The lifecycle of the asynchronous process is called by its Runtime Registry flight unified with the canceled and drained
 */

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { AgentRuntime } from "./types";

const SHELL_PROBE_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

async function commandPathAsync(
  command: string,
  envPath = process.env.PATH ?? "",
  signal?: AbortSignal
) {
  const { stdout } = await execFileAsync("/usr/bin/which", [command], {
    encoding: "utf8",
    env: { PATH: envPath },
    timeout: SHELL_PROBE_TIMEOUT_MS,
    signal,
  });
  const output = String(stdout).trim();
  return output || undefined;
}

async function loginShellPathAsync(signal?: AbortSignal) {
  const shell = process.env.SHELL || "/bin/zsh";
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

export function commonCommandPaths(command: string) {
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
      process.env.PATH ?? "",
      options.signal
    );
    if (executable) {
      append({ executable, path: process.env.PATH ?? "" });
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
    const path = [dirname(executable), process.env.PATH]
      .filter(Boolean)
      .join(":");
    try {
      if (await commandPathAsync(executable, path, options.signal)) {
        append({ executable, path });
      }
    } catch {
      options.signal?.throwIfAborted();
      // 当前候选不可执行，继续下一项。
    }
  }
  return candidates;
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
  } catch {
    signal?.throwIfAborted();
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
  kimi: [0, 29, 2],
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
 * kimi 0.29.2 于 2026-07-29 真机取证解锁（dev/agent-cli-docs.md 内置工具面回归行）。
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
  pathValue = process.env.PATH,
  source: NodeJS.ProcessEnv = process.env
) {
  return {
    HOME: source.HOME,
    PATH: pathValue ?? "/usr/bin:/bin:/usr/sbin:/sbin",
    USER: source.USER,
    SHELL: source.SHELL,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    TMPDIR: source.TMPDIR,
  } satisfies NodeJS.ProcessEnv;
}
