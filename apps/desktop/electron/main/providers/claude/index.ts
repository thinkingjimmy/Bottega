/**
 * [INPUT]: Depends on the lock version of Claude ACP adapter, Registry first-valid flight, user CLI, the managed-policy pre-reader in policy.ts, buildtinTools, oracle, ACP models/turn, authorized processEnv, Native Installer, headless/maintenance and system Skill
 * [OUTPUT]: Provides the Claude backend, minimum supported version, ACP chat, authorization environment, model options with optional probe admission, the Claude plugin's changed settings as SDK options with a workflow role's memory always off (claudePluginOptions, T-P5/T-D08), runtime/auth checks, its Provider bridge readiness plan, managed-policy validation and extensions.
 * [POS]: The only installation point for the Claude descriptor; No pre-checking, no reading, no isolating of the copy of user credentials; managed-policy validation is best-effort because the adapter re-reads the policy in its own process
 * Workflow Skill isolation reaches native Read/Glob/Grep permissions and the Bash sandbox through claudeInteractiveSessionMeta.
 */

import { claudeQuota } from "./quota";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeTurnOptions } from "../../../../shared/ipc/agent/agent-ipc";
import { systemSkillsPath } from "../../skills/catalog/system-skills";
import { npmLatestVersion } from "../../setup/latest-version";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import { classifyAcpFailure } from "../../backends/acp/failure";
import { OPAQUE_CONFIG_VALUE_PATTERN } from "../../backends/runtime/capability-validation";
import {
  builtinToolsForVersion,
  probeRuntimeCandidatesAsync,
  runtimeVersionAtLeast,
} from "../../backends/runtime/runtime-probe";
import type {
  AgentRuntime,
  BackendDescriptor,
  BackendTurnOptions,
  ResolvedRuntime,
  RuntimeConfirmation,
} from "../../backends/types";
import { checkClaudeAuth, claudeRoute } from "./auth";
import { claudeAcpLaunch } from "./environment";
import { CLAUDE_INTERACTIVE_LOCKDOWN, CLAUDE_SERVICE_TIER, claudeTurnValues, validateClaudeSessionId } from "./turn-config";
import { BridgedAcpTurn } from "../host/turns/bridged-turn";
import { requireProviderBridge } from "../host/runtime";
import {
  claudeHeadlessSpec,
  claudeInteractiveSettings,
  CLAUDE_READ_ONLY_TOOLS,
} from "./background/headless";
import { createClaudeMaintenance } from "./background/maintenance";
import { isClaudeModelId, listClaudeModels } from "./background/models";
import {
  describeClaudePolicyRejection,
  readClaudeExecutablePolicy,
  type ClaudeExecutablePolicy,
} from "./policy";
import { SESSION_CAPABILITY_POLICY } from "../../backends/acp/startup/client-capabilities";

const PERMISSIONS = new Set(["ask-for-approval", "approve-for-me"]);
const MINIMUM_VERSION = "2.1.216";
const INSTALL_COMMAND =
  "curl -fsSL https://claude.ai/install.sh | bash";
/* 企业 managed policy 可以改写 adapter 进程里的 CLAUDE_CODE_EXECUTABLE，那条路径
   才是将被 spawn 的路径。发现阶段就让它成为唯一候选，走同一套 identity/版本校验；
   快照复用前再读一次，路径变了就作废重发现。adapter 自己还会再读第三次，
   这中间的毫秒级窗口是"不 patch adapter"裁决下的已知 best-effort 边界。 */
export function createClaudeRuntimeDetection(
  readPolicy: (signal?: AbortSignal) => Promise<ClaudeExecutablePolicy> = (
    signal
  ) => readClaudeExecutablePolicy(undefined, signal),
  probe: (signal?: AbortSignal) => Promise<AgentRuntime[]> = (signal) =>
    probeRuntimeCandidatesAsync({ command: "claude", signal })
) {
  const detectRuntime = async (
    signal?: AbortSignal
  ): Promise<AgentRuntime[]> => {
    const policy = await readPolicy(signal);
    if (policy.kind === "unset") return probe(signal);
    if (policy.kind === "path") {
      return [{ executable: policy.executable, path: process.env.PATH ?? "" }];
    }
    throw new Error(describeClaudePolicyRejection());
  };
  const confirmRuntime = async (
    runtime: ResolvedRuntime,
    signal?: AbortSignal
  ): Promise<RuntimeConfirmation> => {
    const policy = await readPolicy(signal);
    if (policy.kind === "unset") return { status: "confirmed" };
    if (policy.kind === "path" && policy.executable === runtime.executable) {
      return { status: "confirmed" };
    }
    return {
      status: "rejected",
      reason:
        policy.kind === "path"
          ? `Claude managed policy 已将可执行路径改为 ${policy.executable}，重新探测`
          : describeClaudePolicyRejection(),
    };
  };
  return { detectRuntime, confirmRuntime };
}
const claudeRuntimeDetection = createClaudeRuntimeDetection();
const claudeMaintenance = createClaudeMaintenance();

function validate(value: unknown): asserts value is ClaudeTurnOptions {
  if (!value || typeof value !== "object") {
    throw new Error("Claude turn 选项不完整");
  }
  const options = value as Partial<ClaudeTurnOptions>;
  if (options.backend !== "claude") throw new Error("Claude 后端判别值无效");
  if (
    options.model !== undefined &&
    (typeof options.model !== "string" || !isClaudeModelId(options.model))
  ) {
    throw new Error("Claude 模型格式无效");
  }
  if (
    options.reasoningEffort !== undefined &&
    (typeof options.reasoningEffort !== "string" ||
      !OPAQUE_CONFIG_VALUE_PATTERN.test(options.reasoningEffort))
  ) {
    throw new Error("Claude Effort 格式无效");
  }
  if (!PERMISSIONS.has(options.permissionMode ?? "")) {
    throw new Error("Claude 权限档位无效");
  }
  if (
    options.serviceTier !== undefined &&
    !OPAQUE_CONFIG_VALUE_PATTERN.test(options.serviceTier)
  ) {
    throw new Error("Claude Speed 格式无效");
  }
}

const capabilities: Omit<
  ReturnType<BackendDescriptor["capabilitiesFor"]>,
  "builtinTools"
> = {
  resume: true,
  permissionModes: ["ask-for-approval", "approve-for-me"],
  modelOptions: "list-only",
  imageInput: true,
  planMode: true,
  headless: ["title", "format-extract", "install-analysis", "repair", "serve", "subagent"],
  maintenance: true,
};

/* ============================================================
 * 交互档收敛：adapter 的缺省是 `settingSources: ["user","project","local"]`
 * 且不带 `strictMcpConfig`，而它把 `..._meta.claudeCode.options` 展开在
 * 缺省之后——所以这两项是可覆盖的（锁版 0.62.0 acp-agent.js 实测）。
 *
 * `strictMcpConfig` 全关：只认 ACP `session/new` 传入的 server（内置工具
 * 就走那条），工作区里的 `.mcp.json` 与用户 settings 里的第三方 MCP 一律
 * 不加载。产品 headless 侧本就恒带 `--strict-mcp-config`，交互侧此前没有。
 *
 * `settingSources` 只去掉 `local`。**`project` 是留着的，而且是有代价的**：
 * 它同时是 `CLAUDE.md` 的加载开关（SDK 明文如此），而 App 协议要求工作区
 * `CLAUDE.md` 恒为 `@AGENTS.md`（见 apps/source/validate-app.ts，缺失即判 error）。
 * 去掉 project 就等于让所有 App 聊天的 skill 协议静默失效。
 * 于是残留边界必须说明白而不是假装关上了：**工作区根部的
 * `.claude/settings.json` 里的 hooks 仍会执行**。压制它的是另一半——交互
 * settings 走 flag 层且带 deny 规则（deny 恒胜 allow），所以文件里的 allow
 * 提不了权；能提的只有 hooks 本身。
 * 常量本身在 turn-config.ts：模型目录探针用同一份，列出的模型就是 turn 能跑的模型（TASK-13 G）。
 * ============================================================ */

/**
 * `session/new` 的 `_meta.claudeCode.options`。独立成纯函数的理由与
 * `opencodeSpawnConfig` 一样：本接入案的交互侧安全不变量全在这一份里
 * （预批随档位、三条 deny、MCP 与 settings 来源收敛），而这些不变量必须
 * 能在不真的起进程的前提下被断言。
 */
/* T-P5: the Claude plugin's changed settings become SDK options; an untouched default adds nothing. A workflow role's memory is off
   whatever the plugin says (T-D08, disableProviderMemory). `Task` is the subagent tool's older name, `Agent` its current one. */
export const claudePluginOptions = (config: BackendTurnOptions["backendSessionConfig"], disableProviderMemory = false) => {
  const changed = config?.providerSettings ?? {};
  const memoryOff = disableProviderMemory || changed.memory === false;
  const disallowed = [...(changed["native-subagents"] === false ? ["Task", "Agent"] : []), ...(changed["workflow-tool"] === false ? ["Workflow"] : [])];
  const env = { ...(memoryOff ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}), ...(changed["context-1m"] === false ? { CLAUDE_CODE_DISABLE_1M_CONTEXT: "1" } : {}) };
  return {
    memoryOff,
    options: {
      ...(disallowed.length ? { disallowedTools: disallowed } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(changed["claude-in-chrome"] === true ? { extraArgs: { chrome: null } } : {}),
    },
  };
};

export const claudeInteractiveSessionMeta = (turn: Pick<BackendTurnOptions, "filesystemAccess" | "backendSessionConfig" | "disableProviderMemory" | "skillIsolation">
  & { payload: { turnOptions: Pick<BackendTurnOptions["payload"]["turnOptions"], "permissionMode"> } }) => {
  const plugin = claudePluginOptions(turn.backendSessionConfig, turn.disableProviderMemory);
  return turn.filesystemAccess
    ? {
        claudeCode: {
          options: {
            settings: JSON.stringify({
              ...claudeInteractiveSettings(
                turn.filesystemAccess,
                turn.payload.turnOptions.permissionMode === "approve-for-me"
                  ? "approve-for-me"
                  : "ask-for-approval",
                undefined,
                turn.backendSessionConfig?.claudeDisabledPluginIds,
                turn.skillIsolation?.deniedRoots
              ),
              ...(plugin.memoryOff ? { autoMemoryEnabled: false } : {}),
            }),
            ...plugin.options,
            ...CLAUDE_INTERACTIVE_LOCKDOWN,
            ...(turn.skillIsolation ? { settingSources: [], disallowedTools: [...(plugin.options.disallowedTools ?? []), "Skill"] } : {}),
            /* A read-only turn gets no write-capable built-in at all; the sandbox denyWrite and Edit/Write deny stay as the second line (04 §5). */
            ...(turn.filesystemAccess.mode === "read-only" ? { tools: [...CLAUDE_READ_ONLY_TOOLS] } : {}),
            ...(!turn.skillIsolation && turn.backendSessionConfig?.claudePluginPaths?.length
              ? {
                  plugins: turn.backendSessionConfig.claudePluginPaths.map(
                    (path) => ({ type: "local" as const, path })
                  ),
                }
              : {}),
          },
        },
      }
    : {};
};

/* Main builds the launch and the `_meta` fence; the bridge only carries the `_meta` main computed (D1). */
export const claudeSpawnConfig = (options: BackendTurnOptions): AcpSpawnConfig => ({
  ...claudeAcpLaunch(options.runtime, { processEnv: options.processEnv, session: { disableProviderMemory: options.disableProviderMemory } }),
  ...claudeTurnValues,
  sessionMeta: claudeInteractiveSessionMeta,
});

export const claudeBackend: BackendDescriptor = {
  id: "claude",
  displayName: "Claude",
  minimumVersion: MINIMUM_VERSION,
  workspaceDirName: "claude-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.claude,
  quota: claudeQuota,
  serviceTier: CLAUDE_SERVICE_TIER,
  detectRuntime: claudeRuntimeDetection.detectRuntime,
  confirmRuntime: claudeRuntimeDetection.confirmRuntime,
  validateRuntime: (runtime) =>
    runtimeVersionAtLeast(runtime.version, MINIMUM_VERSION)
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `Claude Code 需要 ${MINIMUM_VERSION} 或更高版本。`,
        },
  capabilitiesFor: (runtime) => ({
    ...capabilities,
    builtinTools: builtinToolsForVersion("claude", runtime.version),
  }),
  classifyFailure: classifyAcpFailure,
  auth: {
    check: checkClaudeAuth,
    route: claudeRoute,
  },
  readiness: async (runtime) => ({ launch: { ...claudeAcpLaunch(runtime), cwd: homedir() } }),
  validateTurnOptions: validate,
  validateSessionId: validateClaudeSessionId,
  models: {
    list: (runtime, workspace, signal, runProbe) =>
      listClaudeModels(runtime, workspace, signal, runProbe),
    cached: (runtime, workspace) => listClaudeModels.cached(runtime, workspace),
    invalidate: () => listClaudeModels.invalidate(),
  },
  createTurn: (options) => {
    validate(options.payload.turnOptions);
    const config = claudeSpawnConfig(options);
    return new BridgedAcpTurn(options, config, requireProviderBridge());
  },
  skills: {
    sources: (workspace) => [
      { path: join(homedir(), ".agents", "skills"), scope: "user" },
      { path: join(homedir(), ".claude", "skills"), scope: "user" },
      { path: join(workspace, ".agents", "skills"), scope: "repo" },
      { path: join(workspace, ".claude", "skills"), scope: "repo" },
      { path: systemSkillsPath(), scope: "system" },
    ],
  },
  setup: {
    latestVersion: () => npmLatestVersion("@anthropic-ai/claude-code"),
    selfUpdate: ["update"],
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: { command: "claude update", dangerous: true },
      login: { command: "claude auth login", dangerous: false },
    },
  },
  headless: {
    purposes: ["title", "format-extract", "install-analysis", "repair", "serve", "subagent"],
    spec: claudeHeadlessSpec,
  },
  maintenance: claudeMaintenance,
};
