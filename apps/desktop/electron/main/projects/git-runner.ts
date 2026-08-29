/**
 * [INPUT]: Depends on node: child_process execFile, node: fs/os/path, backends/sandbox/SBPL with main/errors
 * [OUTPUT]: Provides the sole bounded Git execution border, including an explicit pre-spawn platform gate for owned mutations
 * [POS]: The Git single spawn point for projects; git-branches From here, do not create execFile or spell shell
 */

import { execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { asError } from "../errors";
import {
  canonicalPath,
  pathAncestors,
  SANDBOX_EXEC,
  sbplString,
  SYSTEM_READ_FILES,
  SYSTEM_READ_ROOTS,
  uniquePaths,
  writeRules,
} from "../backends/sandbox/sbpl";

const execute = promisify(execFile);

const GIT_TIMEOUT_MS = 30_000;
/** stdout/stderr 各自的字节预算；超出即结构化失败，不把半截输出当结果。 */
const GIT_MAX_BYTES = 4 * 1024 * 1024;
const STDERR_BUDGET = 8 * 1024;

/* ============================================================
 * 1. 禁交互环境
 * 先整族剔除再逐条注入：用户 env 里任何 `GIT_DIR`/`GIT_WORK_TREE`/
 * `GIT_INDEX_FILE`/`GIT_OBJECT_DIRECTORY`/`GIT_ALTERNATE_OBJECT_DIRECTORIES`
 * 都能把「在 A 仓库执行」悄悄改写成「写 B 仓库」。黑名单永远漏一个，
 * 白名单不会。
 * ============================================================ */
const STRIPPED_ENV_PREFIXES = ["GIT_", "GCM_"] as const;
const STRIPPED_ENV_KEYS = [
  "EDITOR",
  "VISUAL",
  "PAGER",
  "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE",
] as const;

export function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if ((STRIPPED_ENV_KEYS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.GCM_INTERACTIVE = "Never";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.LC_ALL = "C";
  return env;
}

/* ============================================================
 * 2. 受控 config
 * 这张表就是 v1 的「显式允许」清单：凡是能让仓库配置在我们权限下执行外部
 * 程序的开关，要么在这里被固定值压死，要么进 §5 的 preflight blocker。
 * 两者都没覆盖的键，说明 v1 的命令集根本不会触发它。
 * ============================================================ */
let hooksDirectory: Promise<string> | null = null;

/** 空 hooks 目录必须真实存在：`core.hooksPath` 指向不存在的路径时 Git 会回落。 */
function ownedEmptyHooksDir() {
  hooksDirectory ??= mkdtemp(join(tmpdir(), "ai-git-hooks-"));
  return hooksDirectory;
}

export function controlledGitArgs(hooksDir: string) {
  return [
    "--no-pager",
    "-c",
    `core.hooksPath=${hooksDir}`,
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.pager=cat",
    "-c",
    "core.editor=false",
    "-c",
    "sequence.editor=false",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
  ];
}

/**
 * diff 家族固定 `--no-ext-diff --no-textconv`：`diff.external` 与
 * `diff.<driver>.textconv` 都是「读一份 diff 就执行一个程序」。自动注入而不是
 * 让每个调用方记得写——记得写就是特殊情况，特殊情况就是漏洞的温床。
 */
const DIFF_SUBCOMMANDS = new Set([
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "format-patch",
  "log",
  "range-diff",
  "show",
  "whatchanged",
]);

export function diffSafeArgs(args: readonly string[]) {
  const [subcommand] = args;
  return subcommand && DIFF_SUBCOMMANDS.has(subcommand)
    ? [subcommand, "--no-ext-diff", "--no-textconv", ...args.slice(1)]
    : [...args];
}

/* ============================================================
 * 3. 结构化错误
 * ============================================================ */
export class GitCommandError extends Error {
  readonly status = 409;

  constructor(
    readonly code: string,
    message: string,
    readonly detail: Readonly<{
      argv: readonly string[];
      cwd: string;
      exitCode?: number | null;
      signal?: NodeJS.Signals | null;
      stderr?: string;
    }>
  ) {
    super(message);
    this.name = "GitCommandError";
  }
}

type ExecFailure = Error & {
  code?: number | string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stderr?: string | Buffer;
};

function toGitError(
  cause: unknown,
  argv: readonly string[],
  cwd: string
): GitCommandError {
  const failure = asError(cause) as ExecFailure;
  const stderr = (
    typeof failure.stderr === "string"
      ? failure.stderr
      : (failure.stderr?.toString("utf8") ?? "")
  )
    .trim()
    .slice(0, STDERR_BUDGET);
  const message = stderr.replace(/^fatal:\s*/i, "") || failure.message;
  if (failure.killed || failure.signal === "SIGTERM") {
    return new GitCommandError("GIT_TIMEOUT", `Git 命令超时：${argv[0] ?? ""}`, {
      argv,
      cwd,
      signal: failure.signal ?? null,
      stderr,
    });
  }
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new GitCommandError("GIT_OUTPUT_OVERFLOW", "Git 输出超出预算", {
      argv,
      cwd,
      stderr,
    });
  }
  return new GitCommandError("GIT_COMMAND_FAILED", message, {
    argv,
    cwd,
    exitCode: typeof failure.code === "number" ? failure.code : null,
    signal: failure.signal ?? null,
    stderr,
  });
}

/* ============================================================
 * 4. Git 执行边界
 * buffered 与 NUL stream 都在本模块内复用同一套 argv/env/config；调用方不得
 * 自建 Git 子进程。mutation 两档只额外决定「要不要串行」与「要不要围栏」。
 * ============================================================ */
export type GitRunOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  /** 只有围栏档使用；read/project 档恒为 undefined。 */
  sandbox?: GitSandboxSpec;
};

async function prepareGitInvocation(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions
) {
  const safe = diffSafeArgs(args);
  const gitArgs = [...controlledGitArgs(await ownedEmptyHooksDir()), ...safe];
  const invocation = options.sandbox
    ? await sandboxedInvocation(gitArgs, options.sandbox, cwd)
    : { command: "git", args: gitArgs };
  return { ...invocation, safe };
}

async function spawnGit(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions
) {
  const invocation = await prepareGitInvocation(cwd, args, options);
  try {
    const result = await execute(invocation.command, invocation.args, {
      cwd,
      encoding: "utf8",
      env: gitEnvironment(),
      maxBuffer: options.maxBytes ?? GIT_MAX_BYTES,
      timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
      // shell 恒关：命令字符串、重定向与 glob 在这条边界上不存在。
      shell: false,
    });
    return result.stdout;
  } catch (cause) {
    throw toGitError(cause, invocation.safe, cwd);
  }
}

/** 只读边界：不占 mutation gate，也不进围栏。 */
export async function runGit(
  workspace: string,
  args: readonly string[],
  options: Omit<GitRunOptions, "sandbox"> = {}
) {
  return spawnGit(requireAbsolute(workspace, "Git cwd"), args, options);
}

type GitNulStreamOptions = Readonly<{
  timeoutMs?: number;
  maxOutputBytes: number;
  maxRecords: number;
  maxRecordBytes: number;
}>;

/**
 * NUL record 流：不累计 stdout。consumer 返回 false、raw bytes/record 任一到顶，
 * 都主动终止 Git 并把结果标成 truncated；spawn/超时/非零退出仍是结构化错误。
 * consumer 必须同步，令一个 data turn 内不存在悬空背压与越界读取。
 */
export async function runGitNulRecords(
  workspace: string,
  args: readonly string[],
  consume: (record: string) => boolean,
  options: GitNulStreamOptions
): Promise<{ truncated: boolean }> {
  const cwd = requireAbsolute(workspace, "Git cwd");
  const budgets = [
    options.maxOutputBytes,
    options.maxRecords,
    options.maxRecordBytes,
  ];
  if (budgets.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError("Git stream budgets 必须是正安全整数");
  }
  const invocation = await prepareGitInvocation(cwd, args, {});
  return new Promise<{ truncated: boolean }>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: gitEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let remainder = "";
    let stderr = "";
    let outputBytes = 0;
    let records = 0;
    let stop: "truncate" | "timeout" | "consumer" | null = null;
    let consumerError: unknown;
    let settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(
      () => stopChild("timeout"),
      options.timeoutMs ?? GIT_TIMEOUT_MS
    );

    function stopChild(reason: NonNullable<typeof stop>, cause?: unknown) {
      if (stop) return;
      stop = reason;
      consumerError = cause;
      child.stdout.destroy();
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      forceTimer.unref();
    }
    function settle(task: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      task();
    }
    function rejectProcess(code: number | null, signal: NodeJS.Signals | null) {
      const failure = Object.assign(
        new Error(stderr || `Git 退出：${code ?? signal ?? "unknown"}`),
        {
          code: code ?? undefined,
          killed: stop === "timeout",
          signal,
          stderr,
        }
      );
      reject(toGitError(failure, invocation.safe, cwd));
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stop) return;
      outputBytes += Buffer.byteLength(chunk, "utf8");
      if (outputBytes > options.maxOutputBytes) {
        stopChild("truncate");
        return;
      }
      remainder += chunk;
      let separator = remainder.indexOf("\0");
      while (separator >= 0) {
        const record = remainder.slice(0, separator);
        remainder = remainder.slice(separator + 1);
        records += 1;
        if (
          records > options.maxRecords ||
          Buffer.byteLength(record, "utf8") > options.maxRecordBytes
        ) {
          stopChild("truncate");
          return;
        }
        try {
          if (!consume(record)) {
            stopChild("truncate");
            return;
          }
        } catch (cause) {
          stopChild("consumer", cause);
          return;
        }
        separator = remainder.indexOf("\0");
      }
      if (Buffer.byteLength(remainder, "utf8") > options.maxRecordBytes) {
        stopChild("truncate");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STDERR_BUDGET) {
        stderr += chunk.slice(0, STDERR_BUDGET - stderr.length);
      }
    });
    child.once("error", (cause) => {
      settle(() => reject(toGitError(cause, invocation.safe, cwd)));
    });
    child.once("close", (code, signal) => {
      settle(() => {
        if (stop === "truncate") {
          resolve({ truncated: true });
          return;
        }
        if (stop === "consumer") {
          reject(consumerError);
          return;
        }
        if (stop === "timeout" || code !== 0) {
          rejectProcess(code, signal);
          return;
        }
        if (remainder !== "") {
          reject(new GitCommandError(
            "GIT_OUTPUT_MALFORMED",
            "Git NUL 输出缺少终止符",
            { argv: invocation.safe, cwd, stderr }
          ));
          return;
        }
        resolve({ truncated: false });
      });
    });
  });
}

export async function tryGit(workspace: string, args: readonly string[]) {
  try {
    return await runGit(workspace, args);
  } catch {
    return null;
  }
}

/**
 * 用户自有仓库的 mutation（Project branch switch/create）。串行化，但**不**进
 * 围栏：这类命令的本职就是写 source working tree，而围栏会连同 smudge filter
 * 一起断掉——把 git-lfs 用户的 checkout 变成 EPERM，不是安全，是回归。
 * 它与只读边界共享同一份禁交互 env 与受控 config（含空 hooksPath，因此仓库
 * 配置的 post-checkout 钩子不再运行）。
 */
export async function runProjectGitMutation(
  workspace: string,
  args: readonly string[],
  options: Omit<GitRunOptions, "sandbox"> = {}
) {
  const cwd = requireAbsolute(workspace, "Git cwd");
  return mutationGate.run(cwd, () => spawnGit(cwd, args, options));
}

export type GitSandboxSpec = Readonly<{
  /** 串行化键与围栏读根：canonical Git common dir */
  commonDir: string;
  /** 本次命令所需的**精确**写面；空集表示这条命令根本不该写盘 */
  writeRoots: readonly string[];
  /** allow 之后的硬 deny；source working tree 恒在此列 */
  denyRoots: readonly string[];
  readRoots?: readonly string[];
}>;

/**
 * 产品自有 worktree 的 mutation：串行 + 专用围栏。
 * 围栏做三件只有 OS 能保证的事——禁网、把可执行子进程限制在受信 Git 链路、
 * 把写面收到本次命令真正需要的那几个子树，并在 allow 之后 deny 掉 source
 * working tree。
 */
export async function runOwnedGitMutation(
  workspace: string,
  args: readonly string[],
  sandbox: GitSandboxSpec,
  options: Omit<GitRunOptions, "sandbox"> = {}
) {
  assertOwnedGitMutationPlatform(process.platform, { argv: args, cwd: workspace });
  const cwd = requireAbsolute(workspace, "Git cwd");
  const commonDir = canonicalPath(sandbox.commonDir, "Git common dir");
  return mutationGate.run(commonDir, () =>
    spawnGit(cwd, args, { ...options, sandbox: { ...sandbox, commonDir } })
  );
}

/* 拒绝要带上是谁被拒的。此前入口门用空 argv/cwd 抛错、真正带上下文的那份
   永远排在它后面，于是非 darwin 上的每一条报错都长得一模一样、无从定位。 */
export function assertOwnedGitMutationPlatform(
  platform: NodeJS.Platform,
  detail: Readonly<{ argv: readonly string[]; cwd: string }> = { argv: [], cwd: "" }
) {
  if (platform !== "darwin") {
    throw new GitCommandError(
      "GIT_SANDBOX_UNAVAILABLE",
      "受管 worktree 的 Git mutation 当前仅支持 macOS seatbelt",
      detail
    );
  }
}

function requireAbsolute(path: string, label: string) {
  return resolve(canonicalPath(path, label));
}

/* ============================================================
 * 5. mutation gate —— 按 canonical Git common dir 串行
 * 产品自己的 worktree add/lock/commit/remove 与 Project branch mutation 不能
 * 在同一 repository 并发；外部 Git 漂移靠每次操作前后复核，不靠这把锁。
 * ============================================================ */
export class GitMutationGate {
  private readonly chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    /* then(task, task)：前一条失败不能把后面的排队者一起卡死。 */
    const result = previous.then(task, task);
    const settled = result.then(
      () => undefined,
      () => undefined
    );
    this.chains.set(key, settled);
    /* 队尾还是自己时才摘链；否则会把后来者的等待对象一起扔掉。 */
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return result;
  }
}

const mutationGate = new GitMutationGate();

/* ============================================================
 * 6. Git 工具链解析
 * 围栏要放行「受信 Git 链路」，就必须先说得出它到底是哪几个文件。
 * ============================================================ */
export type GitToolchain = Readonly<{
  /** PATH 解析到的入口（可能是 xcode-select 垫片） */
  entry: string;
  /** canonical 真身 */
  executable: string;
  /** `git --exec-path`：git-* 子命令所在目录 */
  execPath: string;
  /** 工具链内的真实 git 二进制；垫片场景下与 entry 不同 */
  toolchainExecutable?: string;
}>;

let toolchain: Promise<GitToolchain> | null = null;

function whichGit() {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "git");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new GitCommandError("GIT_NOT_INSTALLED", "未在 PATH 中找到 git", {
    argv: ["git"],
    cwd: process.cwd(),
  });
}

export function resolveGitToolchain(): Promise<GitToolchain> {
  toolchain ??= (async () => {
    const entry = whichGit();
    const execPath = canonicalPath(
      (await runGit(process.cwd(), ["--exec-path"])).trim(),
      "git exec-path"
    );
    /* macOS 的 /usr/bin/git 是 xcode-select 垫片，真身在选定工具链里。只放行
       垫片，围栏内第一次 exec 就 EPERM；而放行 dirname(垫片)=/usr/bin 等于
       把整个系统 bin 交出去。exec-path 反推出的那一个文件才是正解。 */
    const toolchainExecutable = resolve(execPath, "..", "..", "bin", "git");
    let real: string | undefined;
    try {
      accessSync(toolchainExecutable, constants.X_OK);
      real = canonicalPath(toolchainExecutable, "git 工具链二进制");
    } catch {
      real = undefined;
    }
    return {
      entry,
      executable: canonicalPath(entry, "git 可执行文件"),
      execPath,
      ...(real && real !== canonicalPath(entry, "git 可执行文件")
        ? { toolchainExecutable: real }
        : {}),
    };
  })();
  return toolchain;
}

/* ============================================================
 * 7. mutation 围栏
 * ============================================================ */
/**
 * 用户级 Git config 必须可读。围栏里读不到 `~/.gitconfig` 时 Git 不是「忽略
 * 它」，而是 `fatal: unable to access`——一条与权限无关的措辞，正是围栏最擅长
 * 制造的假象。只放行这几个精确入口，主目录其余部分照旧拒读。
 */
export function gitUserConfigReadPaths(env: NodeJS.ProcessEnv) {
  const home = env.HOME;
  const xdg = env.XDG_CONFIG_HOME;
  return {
    files: home ? [join(home, ".gitconfig")] : [],
    roots: [
      xdg ? join(xdg, "git") : undefined,
      home ? join(home, ".config", "git") : undefined,
    ].filter((path): path is string => Boolean(path)),
  };
}

export function buildGitMutationProfile(input: {
  toolchain: GitToolchain;
  cwd: string;
  hooksDir: string;
  sandbox: GitSandboxSpec;
  userConfig: ReturnType<typeof gitUserConfigReadPaths>;
}) {
  const execRoots = uniquePaths([input.toolchain.execPath], "git exec 根");
  const execFiles = [
    ...new Set(
      [
        input.toolchain.entry,
        input.toolchain.executable,
        input.toolchain.toolchainExecutable,
      ].filter((value): value is string => Boolean(value))
    ),
  ];
  const writeRoots = uniquePaths([...input.sandbox.writeRoots], "Git 写根");
  const denyRoots = uniquePaths([...input.sandbox.denyRoots], "Git deny 根");
  const contradiction = writeRoots.find((root) => denyRoots.includes(root));
  if (contradiction) {
    /* 同一条路径既在写根又在 deny 根，说明调用方把「要写的东西」和「绝不能写
       的东西」算成了同一处。嵌套不是矛盾（`.git` 本来就在 source tree 里，
       由下面的具体性排序解决），完全相等才是。 */
    throw new GitCommandError(
      "GIT_SANDBOX_SCOPE_CONFLICT",
      `Git 写根与 deny 根指向同一路径：${contradiction}`,
      { argv: ["sandbox-exec"], cwd: input.cwd }
    );
  }
  const readRoots = uniquePaths(
    [
      ...SYSTEM_READ_ROOTS,
      input.cwd,
      input.hooksDir,
      input.sandbox.commonDir,
      ...(input.sandbox.readRoots ?? []),
      ...input.userConfig.roots,
      ...writeRoots,
      ...execRoots,
    ],
    "Git 读根"
  );
  const readFiles = uniquePaths(input.userConfig.files, "Git 只读文件");
  const traversal = uniquePaths(
    [
      ...readRoots.flatMap(pathAncestors),
      ...readFiles.flatMap(pathAncestors),
      ...execFiles.flatMap(pathAncestors),
      ...SYSTEM_READ_FILES.flatMap(pathAncestors),
    ],
    "Git 路径祖先"
  );
  return `${[
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-fork)",
    /* 只放行受信 Git 链路：仓库配置出来的 filter/hook/textconv 即使被漏进来，
       在这里也 exec 不动——围栏是最后一道，不是唯一一道。 */
    "(allow process-exec",
    ...execRoots.map((path) => `  (subpath ${sbplString(path)})`),
    ...execFiles.map((path) => `  (literal ${sbplString(path)})`),
    ")",
    "(deny file-read*)",
    "(allow file-read-metadata",
    ...traversal.map((path) => `  (literal ${sbplString(path)})`),
    ")",
    "(allow file-read*",
    ...readRoots.map((path) => `  (subpath ${sbplString(path)})`),
    ...readFiles.map((path) => `  (literal ${sbplString(path)})`),
    ...SYSTEM_READ_FILES.map((path) => `  (literal ${sbplString(path)})`),
    '  (subpath "/dev/fd")',
    ")",
    "(deny file-write*)",
    ...writeRules(writeRoots, denyRoots),
    "(deny network*)",
  ].join("\n")}\n`;
}

async function sandboxedInvocation(
  gitArgs: readonly string[],
  sandbox: GitSandboxSpec,
  cwd: string
) {
  assertOwnedGitMutationPlatform(process.platform, { argv: gitArgs, cwd });
  const resolved = await resolveGitToolchain();
  const profile = buildGitMutationProfile({
    toolchain: resolved,
    cwd,
    hooksDir: await ownedEmptyHooksDir(),
    sandbox,
    userConfig: gitUserConfigReadPaths(process.env),
  });
  /* 直接起工具链真身，不经 /usr/bin/git 垫片：那个垫片是 xcrun，第一件事就是
     往 TMPDIR 写 `xcrun_db-*` 缓存，而围栏没给 TMPDIR 写权限——报出来的是
     「couldn't create cache file」，一句完全不提围栏的话。 */
  return {
    command: SANDBOX_EXEC,
    args: [
      "-p",
      profile,
      resolved.toolchainExecutable ?? resolved.executable,
      ...gitArgs,
    ],
  };
}

/* ============================================================
 * 8. 有效 config 枚举与可执行 config 审计
 * ============================================================ */
export type GitConfigEntry = Readonly<{
  origin: string;
  key: string;
  value: string;
}>;

/** `--show-origin -z` 的记录形如 `origin\0key\nvalue\0`。 */
export async function listGitConfig(workspace: string) {
  const raw = await runGit(workspace, [
    "config",
    "--list",
    "--show-origin",
    "-z",
  ]);
  const entries: GitConfigEntry[] = [];
  const tokens = raw.split("\0");
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const origin = tokens[index]!;
    const record = tokens[index + 1]!;
    const separator = record.indexOf("\n");
    entries.push(
      separator < 0
        ? { origin, key: record, value: "" }
        : {
            origin,
            key: record.slice(0, separator),
            value: record.slice(separator + 1),
          }
    );
  }
  return entries;
}

export type GitConfigBlocker = Readonly<{
  code: string;
  key: string;
  origin: string;
  message: string;
}>;

const BOOLEAN_FALSE = new Set(["", "false", "0", "no", "off"]);
const BOOLEAN_TRUE = new Set(["true", "1", "yes", "on"]);

/**
 * v1 的可执行 config 判据。只有两类进 blocker：
 *
 * 1. `filter.<name>.(clean|smudge|process|required)`——checkout/add/commit/diff
 *    都会把它当程序跑，而 filter 名字是任意的，`-c` 压不住一个未知集合；
 * 2. 外部 `core.fsmonitor`（指向 hook 而非布尔值）与 `core.alternateRefsCommand`
 *    ——同样是「读一次就执行一个程序」，且不在受控 config 的固定值覆盖范围内。
 *
 * 其余能执行外部程序的键都已经被 §2 的固定值压死（hooksPath/pager/editor/
 * gpgsign）或被 diff 家族的 `--no-ext-diff --no-textconv` 关掉；credential
 * helper 与 `core.sshCommand` 只在网络操作里出现，而 v1 从不 fetch/push。
 * 不在这两张表上的键，说明 v1 的命令集碰不到它——这就是「显式允许」。
 */
export function auditExecutableGitConfig(
  entries: readonly GitConfigEntry[]
): GitConfigBlocker[] {
  const blockers: GitConfigBlocker[] = [];
  for (const entry of entries) {
    const key = entry.key.toLowerCase();
    const filter = /^filter\.(.+)\.(clean|smudge|process|required)$/.exec(key);
    if (filter) {
      blockers.push({
        code: "GIT_CONFIG_FILTER_DRIVER",
        key: entry.key,
        origin: entry.origin,
        message: `仓库有效配置声明了 filter 驱动 ${filter[1]}（${entry.key}，来自 ${entry.origin}）；v1 不在自动化里执行仓库配置的外部程序。请为该仓库停用它后重试。`,
      });
      continue;
    }
    if (key === "core.fsmonitor") {
      const value = entry.value.trim().toLowerCase();
      if (!BOOLEAN_FALSE.has(value) && !BOOLEAN_TRUE.has(value)) {
        blockers.push({
          code: "GIT_CONFIG_EXTERNAL_FSMONITOR",
          key: entry.key,
          origin: entry.origin,
          message: `仓库配置了外部 fsmonitor 钩子（${entry.value}，来自 ${entry.origin}）；v1 不执行仓库配置的外部程序。`,
        });
      }
      continue;
    }
    if (key === "core.alternaterefscommand") {
      blockers.push({
        code: "GIT_CONFIG_ALTERNATE_REFS_COMMAND",
        key: entry.key,
        origin: entry.origin,
        message: `仓库配置了 core.alternateRefsCommand（来自 ${entry.origin}）；v1 不执行仓库配置的外部程序。`,
      });
    }
  }
  return blockers;
}

/** canonical Git common dir：mutation gate 的键与围栏读根都用它。 */
export async function resolveGitCommonDir(workspace: string) {
  const raw = (await runGit(workspace, ["rev-parse", "--git-common-dir"])).trim();
  return canonicalPath(resolve(workspace, raw), "Git common dir");
}

export async function resolveGitTopLevel(workspace: string) {
  const raw = (await runGit(workspace, ["rev-parse", "--show-toplevel"])).trim();
  return canonicalPath(raw, "Git 仓库根");
}
