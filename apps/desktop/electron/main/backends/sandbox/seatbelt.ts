/**
 * [INPUT]: Depends on Node os/path, sandbox/sbpl path and translation native language, barrier declaration table, HeadlessJob and HeadlessExecutionSpec
 * [OUTPUT]: Provides credential root, dual-directional scanning, job→SBPL and sandbox-exec packaging; Interface file set up adapter/built-in/freeze third party MCP runtime canonical read root, node_modules ancestor with accurate symlink input
 * [POS]: The default macOS OS fence translation layer for backends/sandbox; The path is true in fences.ts, the SBPL source is in sbpl.ts, and the file does not recognize any directory layout of a CLI
 */

import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type {
  HeadlessExecutionSpec,
  HeadlessJob,
} from "../types";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { AgentPermissionMode } from "../../../../shared/agent-ipc";
import {
  assertSeatbeltOwned,
  foreignSensitive,
  ownFiles,
  ownReadOnlyRoots,
  ownRoots,
  seatbeltOwned,
} from "./fences";
import {
  canonicalPath,
  overlaps,
  pathAncestors,
  requestedAbsolutePath,
  SANDBOX_EXEC,
  sbplString,
  SYSTEM_MACH_SERVICES,
  SYSTEM_READ_FILES,
  SYSTEM_READ_ROOTS,
  uniquePaths,
  uniqueRequestedPaths,
  within,
  writeRules,
} from "./sbpl";

export type SeatbeltOptions = {
  platform?: NodeJS.Platform;
  userHome?: string;
  tempDir?: string;
  executable?: string;
  runtimeReadRoots?: string[];
  /** 围栏内的子进程按原始 argv 再次打开 symlink 时，只放行该入口本身。 */
  runtimeReadFiles?: string[];
  /** 即使与 TMPDIR/workspace 写根重叠，也在 allow 后重新 deny write。 */
  protectedReadOnlyRoots?: string[];
  /** 围栏归属；缺省时谁都是外人（最严解释），自有根为空集。 */
  backend?: AgentBackendId;
  /** 子进程实际环境；声明表据此解析自有根，异后端名单再叠加默认位置。 */
  childEnv?: NodeJS.ProcessEnv;
};

const absolutePath = canonicalPath;

export function validateCredentialRoots(
  backend: AgentBackendId,
  job: HeadlessJob,
  spec: HeadlessExecutionSpec,
  options: SeatbeltOptions = {}
) {
  const userHome = absolutePath(options.userHome ?? homedir(), "userHome");
  const roots = uniquePaths(spec.credentialRoots ?? [], "credential root");
  if (!seatbeltOwned(backend)) {
    if (roots.length) {
      throw new Error(`${backend} 原生围栏不接受外部 credential root`);
    }
    return;
  }
  if (roots.length !== 1) {
    throw new Error(`${backend} 必须声明唯一 credential root`);
  }
  const root = roots[0]!;
  const scope = { env: spec.env, userHome };
  if (
    backend === "codex" &&
    job.env !== "isolated-home" &&
    basename(root) !== ".codex"
  ) {
    throw new Error("Codex credential root 必须是独立 .codex 目录");
  }
  // 声明表按子进程 env 解析出的根，必须能对上 spec 自报的那一个：
  // 两者不一致意味着围栏放行的目录与 CLI 实际写入的目录不是同一处。
  const declared = uniquePaths(ownRoots(backend, scope), `${backend} 自有根`);
  if (!declared.includes(root)) {
    throw new Error(`${backend} credential root 与进程环境不一致`);
  }
  const workspace = absolutePath(job.sandboxRoot, "sandboxRoot");
  if (overlaps(root, workspace)) {
    throw new Error(`${backend} credential root 与 workspace 重叠`);
  }
  const foreign = uniquePaths(
    foreignSensitive(backend, scope).roots,
    "敏感凭据根"
  );
  if (foreign.some((path) => overlaps(root, path))) {
    throw new Error(`${backend} credential root 与 foreign sensitive root 重叠`);
  }
}

export function buildSeatbeltProfile(
  job: HeadlessJob,
  options: SeatbeltOptions = {}
) {
  const userHome = absolutePath(options.userHome ?? homedir(), "userHome");
  const tempDir = absolutePath(options.tempDir ?? tmpdir(), "tempDir");
  const scope = { env: options.childEnv ?? {}, userHome };
  // 后端自己的状态根：CLI 必须能读登录态、写会话与日志，否则连认证都无法完成。
  const credentialRoots = options.backend
    ? uniquePaths(ownRoots(options.backend, scope), "seatbelt 自有根")
    : [];
  const ownLiterals = options.backend
    ? uniquePaths(ownFiles(options.backend, scope), "seatbelt 自有文件")
    : [];
  const runtimeReadFiles = uniqueRequestedPaths(
    options.runtimeReadFiles ?? [],
    "seatbelt 运行时入口"
  );
  const readLiterals = [...ownLiterals, ...runtimeReadFiles];
  // 自有可执行面与 caller 声明的受保护来源：读放行，写在 allow 后压回。
  const readOnlyRoots = uniquePaths(
    [
      ...(options.backend ? ownReadOnlyRoots(options.backend, scope) : []),
      ...(options.protectedReadOnlyRoots ?? []),
    ],
    "seatbelt 只读根"
  );
  const writeRoots = uniquePaths(
    [
      tempDir,
      job.homeDir,
      ...credentialRoots,
      job.sandbox === "workspace-write" ? job.sandboxRoot : undefined,
    ],
    "seatbelt 写根"
  );
  /* 重叠裁决：foreign 根落在写根之内靠 deny 行后置压制即可（SBPL 末条
     匹配者胜）。但写根反过来吞没整个主目录是另一回事——那时 deny 名单
     再全也拦不住"围栏内可写 HOME"，唯一诚实的处置是拒绝启动。 */
  const swallowsHome = writeRoots.find((root) => within(userHome, root));
  if (swallowsHome) {
    throw new Error(`seatbelt 写根 ${swallowsHome} 吞没用户主目录`);
  }
  // cwd 无条件入读根：进程起步就要 getcwd，让每个调用方自己记得传是特殊情况。
  const readRoots = uniquePaths(
    [
      ...SYSTEM_READ_ROOTS,
      job.cwd,
      ...job.readRoots,
      ...writeRoots,
      ...readOnlyRoots,
      ...(options.runtimeReadRoots ?? []),
    ],
    "seatbelt 读根"
  );
  const traversalPaths = uniquePaths(
    [
      job.cwd,
      ...readRoots.flatMap(pathAncestors),
      ...readLiterals.flatMap(pathAncestors),
      ...SYSTEM_READ_FILES.flatMap(pathAncestors),
    ],
    "seatbelt 路径祖先"
  );
  // 其余后端的凭据与 ssh/aws/keychain 依旧拒读拒写，跨后端窃取与投毒都不可能。
  const foreign = foreignSensitive(options.backend, scope);
  const sensitiveRoots = uniquePaths(foreign.roots, "敏感根").filter(
    (path) => !credentialRoots.some((root) => within(path, root))
  );
  const sensitiveFiles = uniquePaths(foreign.files, "敏感文件").filter(
    (path) => !ownLiterals.includes(path)
  );
  const lines = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow mach-lookup",
    ...SYSTEM_MACH_SERVICES.map((name) => `  (global-name ${sbplString(name)})`),
    ")",
    "(deny file-read*)",
    "(allow file-read-metadata",
    ...traversalPaths.map((path) => `  (literal ${sbplString(path)})`),
    ")",
    "(allow file-read*",
    ...readRoots.map((path) => `  (subpath ${sbplString(path)})`),
    ...readLiterals.map((path) => `  (literal ${sbplString(path)})`),
    ...SYSTEM_READ_FILES.map((path) => `  (literal ${sbplString(path)})`),
    '  (subpath "/dev/fd")',
    ")",
    "(deny file-write*)",
    ...writeRules(writeRoots, readOnlyRoots),
    /* 逐行发射：过滤后若为空集，零行胜过退化成「拒绝一切」的空 deny 块。
       读写双拒——只拒读挡得住窃取，挡不住投毒：往别人的 bin/ 或 config
       里写一个文件，下次那家 CLI 自己会把它执行掉。 */
    ...sensitiveRoots.flatMap((path) => [
      `(deny file-read* (subpath ${sbplString(path)}))`,
      `(deny file-write* (subpath ${sbplString(path)}))`,
    ]),
    ...sensitiveFiles.flatMap((path) => [
      `(deny file-read* (literal ${sbplString(path)}))`,
      `(deny file-write* (literal ${sbplString(path)}))`,
    ]),
    job.network ? "(allow network*)" : "(deny network*)",
  ];
  return `${lines.join("\n")}\n`;
}

export function wrapWithSeatbelt(
  job: HeadlessJob,
  spec: HeadlessExecutionSpec,
  options: SeatbeltOptions = {}
): HeadlessExecutionSpec {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new Error("无人值守 OS 围栏当前仅支持 macOS seatbelt");
  }
  if (!isAbsolute(spec.command)) {
    throw new Error("Agent runtime 必须是绝对路径");
  }
  const requestedCommand = resolve(spec.command);
  const resolvedCommand = absolutePath(spec.command, "Agent runtime");
  const profile = buildSeatbeltProfile(job, {
    ...options,
    tempDir: options.tempDir ?? spec.env.TMPDIR,
    childEnv: options.childEnv ?? spec.env,
    runtimeReadRoots: [
      ...(options.runtimeReadRoots ?? []),
      dirname(requestedCommand),
      dirname(resolvedCommand),
    ],
  });
  return {
    ...spec,
    command: options.executable ?? SANDBOX_EXEC,
    args: ["-p", profile, resolvedCommand, ...spec.args],
  };
}

/**
 * 「被 spawn 的运行时」需要的只读面：launcher（codex-acp adapter 走
 * Electron run-as-node）与内置 MCP server（同样是 Electron run-as-node +
 * out/ 构建入口）是同一件事，共用同一个推导，不写两份平行逻辑。
 *
 * 三条实测规则（2026-08-07 sandbox-exec 逐项验证）：
 * 1. `.app` 内的二进制必须放行整个 bundle——只放 `MacOS/` 目录，dyld 读不到
 *    `Contents/Frameworks`，死状是 `Library not loaded`，不是 EPERM；
 * 2. 绝对路径入口脚本放行其目录及 node_modules 祖先——adapter 的依赖链在
 *    pnpm store 里向上解析，只放 `dist/` 一层 require 立刻断；
 * 3. 读数据按 canonical 真身解析；但 adapter 在围栏内按 CODEX_PATH 再次
 *    spawn symlink 时，内核会先读原始入口的 metadata。只放 canonical 根会
 *    在这里得到 EPERM，故额外放行**精确入口 literal**，不放开整个 alias 目录。
 * socket 连回不在此列：`(allow network*)` 已覆盖 AF_UNIX connect。
 */
function spawnRuntimeReadAccess(spec: { command: string; args: string[] }) {
  const requestedExecutable = requestedAbsolutePath(
    spec.command,
    "围栏运行时命令"
  );
  const executable = absolutePath(spec.command, "围栏运行时命令");
  let bundle = dirname(executable);
  for (let current = bundle; current !== dirname(current); current = dirname(current)) {
    if (current.endsWith(".app")) {
      bundle = current;
      break;
    }
  }
  const roots = [bundle];
  addNodeModulesAncestors(roots, dirname(executable));
  const files =
    requestedExecutable === executable ? [] : [requestedExecutable];
  const entry = spec.args.find((value) => isAbsolute(value));
  if (entry) {
    const requestedEntry = requestedAbsolutePath(entry, "围栏运行时入口");
    const canonicalEntry = absolutePath(entry, "围栏运行时入口");
    const entryDir = dirname(canonicalEntry);
    roots.push(entryDir);
    if (requestedEntry !== canonicalEntry) files.push(requestedEntry);
    addNodeModulesAncestors(roots, entryDir);
  }
  return { roots, files };
}

function addNodeModulesAncestors(roots: string[], start: string) {
  for (let current = start; current !== dirname(current); current = dirname(current)) {
    if (basename(current) === "node_modules") roots.push(current);
  }
}

export function wrapInteractiveWithSeatbelt(input: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  backend: AgentBackendId;
  permissionMode: AgentPermissionMode;
  workspace: string;
  readOnlyRoots: string[];
  controlRoot: string;
  /** 本 turn 注入的内置 MCP server spec；缺席（无 lease）则不放行任何产品运行时读根。 */
  builtinMcpServer?: { command: string; args: string[] };
  /** 用户显式配置且由 main 冻结的整 server；只开放其绝对 executable/入口读面。 */
  thirdPartyMcpServers?: readonly {
    command: string;
    args: readonly string[];
  }[];
  /**
   * Agent CLI 真身。launcher 经 adapter 间接 spawn CLI 时（Codex：Electron
   * run-as-node 起 codex-acp，再由它 spawn CODEX_PATH），CLI 二进制不是围栏
   * 直接子进程，dirname(command) 那条既有通道摸不到它——必须显式声明。
   */
  agentRuntime?: string;
  /** readiness 不需要联网；普通 turn 缺省保持联网。 */
  network?: boolean;
  platform?: NodeJS.Platform;
  sandboxExecutable?: string;
}) {
  if ((input.platform ?? process.platform) !== "darwin") {
    throw new Error("交互 Agent OS 围栏当前仅支持 macOS");
  }
  assertSeatbeltOwned(input.backend);
  const command = absolutePath(input.command, "Agent runtime");
  const controlRoot = absolutePath(input.controlRoot, "controlRoot");
  const controlParent = dirname(controlRoot);
  if (input.permissionMode === "full-access") {
    const profile = [
      "(version 1)",
      "(allow default)",
      `(deny file-write* (subpath ${sbplString(controlRoot)}))`,
      `(deny file-write* (literal ${sbplString(controlParent)}))`,
      "",
    ].join("\n");
    return {
      command: input.sandboxExecutable ?? SANDBOX_EXEC,
      args: ["-p", profile, command, ...input.args],
    };
  }
  const job: HeadlessJob = {
    purpose: "subagent",
    cwd: input.workspace,
    sandboxRoot: input.workspace,
    readRoots: input.readOnlyRoots,
    toolPolicy: "workspace",
    ephemeral: false,
    prompt: "",
    sandbox: "workspace-write",
    network: input.network ?? true,
    approvalPolicy: "never",
    env: "user-default",
    ignoreUserConfig: false,
    timeoutMs: 0,
  };
  const runtimeAccess = [
    spawnRuntimeReadAccess({ command, args: input.args }),
    ...(input.builtinMcpServer
      ? [spawnRuntimeReadAccess(input.builtinMcpServer)]
      : []),
    ...(input.thirdPartyMcpServers ?? []).map((server) =>
      spawnRuntimeReadAccess({
        command: server.command,
        args: [...server.args],
      })
    ),
    ...(input.agentRuntime
      ? [spawnRuntimeReadAccess({ command: input.agentRuntime, args: [] })]
      : []),
  ];
  const wrapped = wrapWithSeatbelt(
    job,
    {
      command,
      args: input.args,
      env: input.env,
      parseLine() {},
    },
    {
      backend: input.backend,
      childEnv: input.env,
      runtimeReadRoots: runtimeAccess.flatMap((access) => access.roots),
      runtimeReadFiles: runtimeAccess.flatMap((access) => access.files),
      protectedReadOnlyRoots: input.readOnlyRoots,
    }
  );
  const profile = `${wrapped.args[1] as string}(deny file-write* (subpath ${sbplString(controlRoot)}))\n(deny file-write* (literal ${sbplString(controlParent)}))\n`;
  return {
    command: input.sandboxExecutable ?? wrapped.command,
    args: ["-p", profile, command, ...input.args],
  };
}
