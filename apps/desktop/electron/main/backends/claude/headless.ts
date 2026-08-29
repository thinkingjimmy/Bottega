/**
 * [INPUT]: Depends on Claude cloud routing allowlists, user credential root, frozen product plugin overlay, authorized processEnv, sandbox paths, and HeadlessJob/ExecutionSpec
 * [OUTPUT]: Provides sandbox and flag-layer settings for interactive/headless Claude, user-default command translation, and structured_output resolution
 * [POS]: Claude authorization translator; it preserves login HOME while applying the same per-plugin product deny layer to chat and subagent processes
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { foreignSensitive } from "../sandbox/fences";
import type {
  HeadlessExecutionSpec,
  HeadlessJob,
  HeadlessParserState,
  ResolvedRuntime,
} from "../types";
import { claudeAdapterEnvironment } from "./environment";
import type { BackendTurnOptions } from "../types";

const MAX_BUDGET_USD = "5";
const MAX_TURNS = "64";
const BUILTIN_TOOLS = "Bash,Read,Edit,Write,Glob,Grep";
const MAX_SCHEMA_BYTES = 1024 * 1024;

const unique = (values: string[]) => [...new Set(values)];
const permissionPath = (path: string) => `//${path.replace(/^\/+/, "")}/**`;

/**
 * 一条路径发两条规则：子树与其自身。调用方因此**不必知道**这个路径是目录
 * 还是文件——`.netrc` 这种单文件项被 `/**` 漏掉，正是"要么维护第二张表、
 * 要么留个洞"的经典特殊情况。多发一行，特殊情况消失。
 */
const permissionRules = (tool: string, paths: string[]) =>
  unique(paths).flatMap((path) => {
    const target = `//${path.replace(/^\/+/, "")}`;
    return [`${tool}(${target}/**)`, `${tool}(${target})`];
  });

/**
 * 拒的是「别人的凭据」：其余 Agent 后端的登录态与云厂商密钥。
 * 不含 ~/.claude——那是本进程自己的登录态，拒了等于 CLI 无法认证（Not logged in）。
 *
 * 路径真相**只有一处**：`sandbox/fences.ts` 的声明表。曾经这里有一张手写的
 * 平行名单，于是它与声明表走散——缺 opencode 全部状态根、缺 `~/.gnupg` 与
 * `Library/Keychains`、也不认 XDG override 后的旧位置，结果是 Claude 的
 * 沙箱 Bash 读得到 seatbelt 家族双 deny 的面。`foreignSensitive` 对 claude
 * 是合法调用（它不要求 seatbeltOwned），一张表服务四家。
 */
function foreignCredentialPaths(userHome: string) {
  const fence = foreignSensitive("claude", { env: process.env, userHome });
  return unique([...fence.roots, ...fence.files]);
}

export function claudeHeadlessSettings(
  job: HeadlessJob,
  userHome = homedir()
) {
  const readRoots = unique(job.readRoots);
  const readRules = readRoots.map((path) => `Read(${permissionPath(path)})`);
  const writeRules =
    job.sandbox === "workspace-write"
      ? [
          `Edit(${permissionPath(job.sandboxRoot)})`,
          `Write(${permissionPath(job.sandboxRoot)})`,
        ]
      : [];
  const hasTools = job.toolPolicy === "workspace";
  const settings = {
    permissions: {
      defaultMode: "dontAsk",
      allow: hasTools ? ["Bash", ...readRules, ...writeRules] : [],
      deny: [
        "WebFetch",
        "WebSearch",
        "NotebookEdit",
        ...(!hasTools || job.sandbox === "read-only" ? ["Edit", "Write"] : []),
        ...(!hasTools ? ["Bash", "Read", "Glob", "Grep"] : []),
      ],
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: hasTools,
      excludedCommands: [],
      allowUnsandboxedCommands: false,
      filesystem: {
        disabled: false,
        allowWrite:
          job.sandbox === "workspace-write" ? [job.sandboxRoot] : [],
        denyWrite: job.sandbox === "read-only" ? [job.sandboxRoot] : [],
        denyRead: [userHome],
        allowRead: readRoots,
      },
      credentials: {
        files: foreignCredentialPaths(userHome).map((path) => ({
          path,
          mode: "deny",
        })),
        envVars: [
          "ANTHROPIC_AUTH_TOKEN",
          "ANTHROPIC_API_KEY",
          "ANTHROPIC_AWS_API_KEY",
          "ANTHROPIC_CUSTOM_HEADERS",
          "ANTHROPIC_FOUNDRY_API_KEY",
          "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
          "AWS_ACCESS_KEY_ID",
          "AWS_SECRET_ACCESS_KEY",
          "AWS_SESSION_TOKEN",
          "AWS_BEARER_TOKEN_BEDROCK",
          "AWS_CONTAINER_AUTHORIZATION_TOKEN",
          "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
          "AWS_WEB_IDENTITY_TOKEN_FILE",
          "GOOGLE_APPLICATION_CREDENTIALS",
          "AZURE_CLIENT_SECRET",
          "AZURE_CLIENT_CERTIFICATE_PASSWORD",
          "AZURE_CLIENT_CERTIFICATE_PATH",
          "AZURE_FEDERATED_TOKEN_FILE",
          "IDENTITY_HEADER",
          "MSI_SECRET",
          "GITHUB_TOKEN",
          "GH_TOKEN",
          "NPM_TOKEN",
        ].map((name) => ({ name, mode: "deny" })),
      },
      network: {
        allowedDomains: job.network ? ["*"] : [],
        strictAllowlist: !job.network,
      },
    },
  } as {
    permissions: {
      defaultMode: string;
      allow: string[];
      deny: string[];
    };
    sandbox: {
      enabled: boolean;
      failIfUnavailable: boolean;
      autoAllowBashIfSandboxed: boolean;
      excludedCommands: string[];
      allowUnsandboxedCommands: boolean;
      filesystem: {
        disabled: boolean;
        allowWrite: string[];
        denyWrite: string[];
        denyRead: string[];
        allowRead: string[];
      };
      credentials: {
        files: Array<{ path: string; mode: string }>;
        envVars: Array<{ name: string; mode: string }>;
      };
      network: { allowedDomains: string[]; strictAllowlist: boolean };
    };
    enabledPlugins?: Record<string, false>;
  };
  if (job.claudeDisabledPluginIds?.length) {
    settings.enabledPlugins = Object.fromEntries(
      job.claudeDisabledPluginIds.map((id) => [id, false] as const)
    );
  }
  return settings;
}

/**
 * `--settings` 是 argv 传递的（adapter→CLI 那一跳），跨 chat 只读根又随
 * chat 数量线性增长。撞上 ARG_MAX 的死状是 spawn 失败——一句与设置无关的
 * 错误。与其让它在某个不知道第几个 chat 时炸，不如在这里当场说清是什么。
 * 阈值远低于 macOS 的 1MB argv 预算，留足环境变量与其余参数的余量。
 */
const MAX_SETTINGS_BYTES = 256 * 1024;

export function claudeInteractiveSettings(
  access: NonNullable<BackendTurnOptions["filesystemAccess"]>,
  permissionMode: "ask-for-approval" | "approve-for-me",
  userHome = homedir(),
  disabledPluginIds: readonly string[] = []
) {
  const settings = claudeHeadlessSettings(
    {
      purpose: "subagent",
      cwd: access.workspace,
      sandboxRoot: access.workspace,
      readRoots: access.readOnlyRoots,
      toolPolicy: "workspace",
      ephemeral: false,
      prompt: "",
      sandbox: "workspace-write",
      network: true,
      approvalPolicy: "never",
      env: "user-default",
      ignoreUserConfig: false,
      timeoutMs: 0,
    },
    userHome
  );
  /* `disableSideloadFlags` only works in managed settings, which the product
     cannot author. Per-plugin flag-layer false is the narrow controllable gate. */
  if (disabledPluginIds.length) {
    settings.enabledPlugins = Object.fromEntries(
      disabledPluginIds.map((id) => [id, false])
    );
  }
  const writeProtected = [access.controlRoot, ...access.readOnlyRoots];
  settings.sandbox.filesystem.denyWrite = writeProtected;
  settings.sandbox.filesystem.allowRead = [
    access.workspace,
    ...access.readOnlyRoots,
  ];
  /* 档位的真相在 ACP `session/set_mode`（descriptor 的 modeValues 映射）。
     settings 这层只声明**底线**——恒 `default`（逐条审批），由 set_mode
     单向抬高。继承 headless 的 `dontAsk` 是对用户撒谎（那是无人值守才成立
     的语义），而写一个会随档位变的值，等于给同一件事立第二个真相源。 */
  settings.permissions.defaultMode = "default";
  /* 预批只属于 approve-for-me。ask 档下发 `allow: ["Bash", Edit(ws), Write(ws)]`
     等于：UI 上写着"逐条审批"，shell 与工作区写入却一次都不弹——审批档位
     的全部承诺当场落空。`autoAllowBashIfSandboxed` 是同一件事的沙箱侧开关。 */
  const preapproved = permissionMode === "approve-for-me";
  if (!preapproved) settings.permissions.allow = [];
  settings.sandbox.autoAllowBashIfSandboxed = preapproved;
  /* 三条不变量此前**只**落在 `sandbox.filesystem`——那层只约束被沙箱化的
     Bash 命令，对 CLI in-process 的 Edit/Write/Read 零约束。permission rules
     才是管内置工具的那一层，且 deny 胜 allow、也胜用户自己 settings.json 里
     的 allow（我们这份走 flag 层，用户可控层里优先级最高）。 */
  /* 交互档放开联网检索。headless 拒 WebFetch/WebSearch 是因为无人值守任务
     不该出网；而交互 turn 的沙箱本就 `allowedDomains:["*"]`，Bash 一句
     curl 就出去了——留着这两条 deny 换不来任何安全，只是让产品内的 Claude
     永远不能搜，而这个能力落差从未在 capability/UI 上声明过。 */
  const online = new Set(["WebFetch", "WebSearch"]);
  settings.permissions.deny = [
    ...settings.permissions.deny.filter((rule) => !online.has(rule)),
    ...permissionRules("Edit", writeProtected),
    ...permissionRules("Write", writeProtected),
    ...permissionRules("Read", foreignCredentialPaths(userHome)),
  ];
  const bytes = Buffer.byteLength(JSON.stringify(settings), "utf8");
  if (bytes > MAX_SETTINGS_BYTES) {
    throw new Error(
      `Claude 交互 settings 过大（${Math.round(bytes / 1024)}KB，上限 ${
        MAX_SETTINGS_BYTES / 1024
      }KB）：跨 chat 只读根 ${access.readOnlyRoots.length} 个，请关闭跨 chat 读取或减少 chat 数量`
    );
  }
  return settings;
}

function parseText(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((item) =>
    item &&
    typeof item === "object" &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string"
      ? [(item as { text: string }).text]
      : []
  );
  return text.length > 0 ? text.join("") : undefined;
}

function setText(text: string, state: HeadlessParserState) {
  state.text = text;
}

function parseEventLine(
  line: string,
  state: HeadlessParserState,
  wantsJson: boolean
) {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  const record = event as {
    type?: unknown;
    result?: unknown;
    structured_output?: unknown;
    is_error?: unknown;
    message?: { content?: unknown };
  };
  if (record.type === "result") {
    if (typeof record.result === "string") setText(record.result, state);
    if (record.is_error === true) {
      state.error =
        typeof record.result === "string"
          ? `Claude headless 失败：${record.result}`
          : "Claude headless 返回错误结果";
      return;
    }
    if (!wantsJson) return;
    if (record.structured_output === undefined) {
      state.json = undefined;
      state.error = "Claude 未返回 --json-schema 对应的 structured_output";
      return;
    }
    state.json = record.structured_output;
    if (!state.text) state.text = JSON.stringify(record.structured_output);
    return;
  }
  if (record.type !== "assistant") return;
  const text = parseText(record.message?.content);
  if (text !== undefined) setText(text, state);
}

function outputSchema(path: string) {
  const source = readFileSync(path);
  if (source.byteLength > MAX_SCHEMA_BYTES) {
    throw new Error("Claude output schema 超过 1MB");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.toString("utf8"));
  } catch (cause) {
    throw new Error("Claude output schema 不是合法 JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude output schema 必须是 JSON object");
  }
  return JSON.stringify(parsed);
}

export function claudeHeadlessSpec(
  job: HeadlessJob,
  runtime: ResolvedRuntime
): HeadlessExecutionSpec {
  if (job.env !== "user-default" || job.homeDir) {
    throw new Error("Claude headless job 必须使用 user-default 环境");
  }
  const tools = job.toolPolicy === "workspace" ? BUILTIN_TOOLS : "";
  const settings = claudeHeadlessSettings(job);
  const schema = job.outputSchema ? outputSchema(job.outputSchema) : undefined;
  return {
    command: runtime.executable,
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "dontAsk",
      "--tools",
      tools,
      // 无条件显式声明：SUBPROCESS_ENV_SCRUB 加固下省略此项会把权限档位打回 default，
      // 空串正是 title job 想要的「一个工具都不给」，不必为空集单开分支。
      "--allowedTools",
      settings.permissions.allow.join(","),
      // 不用 --bare：它明确不读 OAuth 与 keychain，用户以 OAuth 登录时必然 Not logged in。
      // 隔离用户配置改由 setting-sources 空集承担，与 Codex 的 ignoreUserConfig 语义对齐。
      ...(job.ignoreUserConfig ? ["--setting-sources", ""] : []),
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--settings",
      JSON.stringify(settings),
      "--max-budget-usd",
      MAX_BUDGET_USD,
      "--max-turns",
      MAX_TURNS,
      ...(schema ? ["--json-schema", schema] : []),
      ...(job.ephemeral ? ["--no-session-persistence"] : []),
      ...(job.model ? ["--model", job.model] : []),
    ],
    env: { ...claudeAdapterEnvironment(runtime), ...job.processEnv },
    /* stdin 不声明：executor 缺省投递的就是 prompt + <untrusted> 包裹，
       在这里复刻一遍只会随 executor 演化而漂移。 */
    osSandbox: "backend",
    parseLine: (line, state) =>
      parseEventLine(line, state, Boolean(job.outputSchema)),
  };
}
