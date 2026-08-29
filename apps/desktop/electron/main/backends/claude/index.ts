/**
 * [INPUT]: Depends on the lock version of Claude ACP adapter, Registry first-valid flight, user CLI, buildtinTools, oracle, ACP models/turn, authorized processEnv, Native Installer, headless/maintenance and system Skill
 * [OUTPUT]: Provides Claude backend: Unified ACP chat, authorization environment, model, Effort, Plan, image, version control Section, runtime/auth and backend extension
 * [POS]: The only installation point for the Claude descriptor; No pre-checking, no reading, no isolating of the copy of user credentials
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeTurnOptions } from "../../../../shared/agent-ipc";
import { systemSkillsPath } from "../../system-skills";
import { githubLatestVersion } from "../../setup/latest-version";
import { AcpTurn } from "../acp/acp-turn";
import { classifyAcpFailure } from "../acp/failure";
import { OPAQUE_CONFIG_VALUE_PATTERN } from "../capability-validation";
import {
  builtinToolsForVersion,
  probeRuntimeCandidatesAsync,
  runtimeVersionAtLeast,
} from "../runtime-probe";
import type {
  BackendDescriptor,
  BackendTurnOptions,
} from "../types";
import { checkClaudeAuth } from "./auth";
import { claudeAcpLaunch, validateClaudeSessionId } from "./environment";
import {
  claudeHeadlessSpec,
  claudeInteractiveSettings,
} from "./headless";
import { createClaudeMaintenance } from "./maintenance";
import { isClaudeModelId, listClaudeModels } from "./models";
import { SESSION_CAPABILITY_POLICY } from "../acp/session/client-capabilities";

const PERMISSIONS = new Set(["ask-for-approval", "approve-for-me"]);
const MINIMUM_VERSION = "2.1.216";
const INSTALL_COMMAND =
  "curl -fsSL https://claude.ai/install.sh | bash";
const findClaudeRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({ command: "claude", signal });
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
  headless: ["title", "install-analysis", "repair", "serve", "subagent"],
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
 * `CLAUDE.md` 恒为 `@AGENTS.md`（见 apps/validate-app.ts，缺失即判 error）。
 * 去掉 project 就等于让所有 App 聊天的 skill 协议静默失效。
 * 于是残留边界必须说明白而不是假装关上了：**工作区根部的
 * `.claude/settings.json` 里的 hooks 仍会执行**。压制它的是另一半——交互
 * settings 走 flag 层且带 deny 规则（deny 恒胜 allow），所以文件里的 allow
 * 提不了权；能提的只有 hooks 本身。
 * ============================================================ */
const CLAUDE_INTERACTIVE_LOCKDOWN = {
  strictMcpConfig: true,
  settingSources: ["user", "project"],
} as const;

/**
 * `session/new` 的 `_meta.claudeCode.options`。独立成纯函数的理由与
 * `opencodeSpawnConfig` 一样：本接入案的交互侧安全不变量全在这一份里
 * （预批随档位、三条 deny、MCP 与 settings 来源收敛），而这些不变量必须
 * 能在不真的起进程的前提下被断言。
 */
export const claudeInteractiveSessionMeta = (turn: BackendTurnOptions) =>
  turn.filesystemAccess
    ? {
        claudeCode: {
          options: {
            settings: JSON.stringify(
              claudeInteractiveSettings(
                turn.filesystemAccess,
                turn.payload.turnOptions.permissionMode === "approve-for-me"
                  ? "approve-for-me"
                  : "ask-for-approval",
                undefined,
                turn.backendSessionConfig?.claudeDisabledPluginIds
              )
            ),
            ...CLAUDE_INTERACTIVE_LOCKDOWN,
            ...(turn.backendSessionConfig?.claudePluginPaths?.length
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

const CLAUDE_SERVICE_TIER = {
  configOptionId: "fast",
  values: { default: "off", priority: "on" },
} as const;

export const claudeBackend: BackendDescriptor = {
  id: "claude",
  displayName: "Claude",
  workspaceDirName: "claude-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.claude,
  serviceTier: CLAUDE_SERVICE_TIER,
  detectRuntime: findClaudeRuntime,
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
  },
  validateTurnOptions: validate,
  validateSessionId: validateClaudeSessionId,
  models: {
    list: (runtime, workspace, signal) =>
      listClaudeModels(runtime, workspace, signal),
    invalidate: () => listClaudeModels.invalidate(),
  },
  createTurn: (options) => {
    validate(options.payload.turnOptions);
    return new AcpTurn(options, {
      ...claudeAcpLaunch(options.runtime, { processEnv: options.processEnv }),
      validateSessionId: validateClaudeSessionId,
      resumeWithoutReplay: true,
      modeValues: {
        default: "default",
        plan: "plan",
        approveForMe: ["auto", "acceptEdits"],
      },
      serviceTierValues: CLAUDE_SERVICE_TIER.values,
      serviceTierConfigId: CLAUDE_SERVICE_TIER.configOptionId,
      classifyFailure: claudeBackend.classifyFailure,
      reviewResidualApprovals: true,
      sessionMeta: claudeInteractiveSessionMeta,
    });
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
    latestVersion: () => githubLatestVersion("anthropics/claude-code"),
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      login: { command: "claude auth login", dangerous: false },
    },
  },
  headless: {
    purposes: ["title", "install-analysis", "repair", "serve", "subagent"],
    spec: claudeHeadlessSpec,
  },
  maintenance: claudeMaintenance,
};
