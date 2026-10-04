/**
 * [INPUT]: Depends on the Codex-ACP, Registry first-valid flight, codex quadrangular auth, ACP turn/models, authorized processEnv, frozen MCP backend-config, installers and headless/maintenance
 * [OUTPUT]: Provides codexBackend, its minimum supported version, ACP chat, third-party MCP wiring, read-only Skill sources, auth, its Provider bridge readiness plan, approvals, model options and background capabilities.
 * Passes the main-owned workflow memory policy into the ACP launcher.
 * [POS]: The only chat installation point for the Codex descriptor; Skills are Library-first product state — this backend only declares read-only discovery roots and never writes or reconciles Codex-native Skill config
 */

import { codexQuota } from "./quota";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexTurnOptions } from "../../../../shared/ipc/agent/codex-ipc";
import { systemSkillsPath } from "../../skills/catalog/system-skills";
import { npmLatestVersion } from "../../setup/latest-version";
import { codexEnvironment, findCodexRuntime } from "./environment";
import { classifyAcpFailure } from "../../backends/acp/failure";
import { CODEX_SERVICE_TIER, codexTurnValues } from "./turn-config";
import { BridgedAcpTurn } from "../host/turns/bridged-turn";
import { requireProviderBridge } from "../host/runtime";
import {
  MODEL_ID_PATTERN,
  OPAQUE_CONFIG_VALUE_PATTERN,
} from "../../backends/runtime/capability-validation";
import {
  builtinToolsForVersion,
  runtimeVersionAtLeast,
} from "../../backends/runtime/runtime-probe";
import type { BackendDescriptor } from "../../backends/types";
import { codexModelCatalog } from "./background/models";
import {
  codexAcpLaunch,
  validateCodexSessionId,
} from "./adapter-entry";
import { checkCodexAuth, codexRoute } from "./auth";
import { codexHeadlessSpec } from "./background/headless";
import { codexMaintenance } from "./background/maintenance";
import { SESSION_CAPABILITY_POLICY } from "../../backends/acp/startup/client-capabilities";

const PERMISSION_MODES = new Set([
  "ask-for-approval",
  "approve-for-me",
  "full-access",
]);
const MINIMUM_VERSION = "0.145.0";
const INSTALL_COMMAND =
  "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
/* 装与登是两种永不同时成立的状态，指令必须分开：一句「请安装
   Codex CLI，并在终端运行 codex login」在已装的机器上前半句就是
   谎话。主权承诺两态都要说，故提取复用。 */
function assertCodexOptions(value: unknown): asserts value is CodexTurnOptions {
  if (!value || typeof value !== "object") {
    throw new Error("Codex turn 选项不完整");
  }
  const options = value as Partial<CodexTurnOptions>;
  if (options.backend !== "codex") throw new Error("Codex 后端判别值无效");
  if (typeof options.model !== "string" || !MODEL_ID_PATTERN.test(options.model)) {
    throw new Error("Codex 模型格式无效");
  }
  if (
    typeof options.reasoningEffort !== "string" ||
    !OPAQUE_CONFIG_VALUE_PATTERN.test(options.reasoningEffort)
  ) {
    throw new Error("Codex Effort 格式无效");
  }
  if (
    typeof options.serviceTier !== "string" ||
    !OPAQUE_CONFIG_VALUE_PATTERN.test(options.serviceTier)
  ) {
    throw new Error("Codex Speed 格式无效");
  }
  if (!PERMISSION_MODES.has(options.permissionMode ?? "")) {
    throw new Error("Codex 权限档位无效");
  }
}

// builtinTools 由 oracle 按 runtime 版本推导（实测锚点 0.144.4，低于产品
// 最低线 0.145.0，故所有可安装版本都解锁）；硬编码第二份真相已废除。
const capabilities: Omit<
  ReturnType<BackendDescriptor["capabilitiesFor"]>,
  "builtinTools"
> = {
  resume: true,
  permissionModes: [
    "ask-for-approval",
    "approve-for-me",
    "full-access",
  ],
  modelOptions: "full",
  imageInput: true,
  planMode: true,
  headless: ["title", "install-analysis", "repair", "serve", "subagent"],
  maintenance: true,
};

export const codexBackend: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",
  minimumVersion: MINIMUM_VERSION,
  workspaceDirName: "codex-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.codex,
  quota: codexQuota,
  serviceTier: CODEX_SERVICE_TIER,
  detectRuntime: findCodexRuntime,
  // version 探针与 turn/headless 同政策：CODEX_HOME 随 env 漂移时，
  // 探针必须落在同一状态根，否则会在错位目录建目录、落缓存。
  versionEnvironment: codexEnvironment,
  validateRuntime: (runtime) =>
    runtimeVersionAtLeast(runtime.version, MINIMUM_VERSION)
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `Codex CLI 需要 ${MINIMUM_VERSION} 或更高版本。`,
        },
  capabilitiesFor: (runtime) => ({
    ...capabilities,
    builtinTools: builtinToolsForVersion("codex", runtime.version),
  }),
  classifyFailure: classifyAcpFailure,
  auth: {
    check: checkCodexAuth,
    route: codexRoute,
  },
  readiness: async (runtime) => ({ launch: { ...codexAcpLaunch(runtime, { session: {} }), cwd: homedir() } }),
  validateTurnOptions: assertCodexOptions,
  validateSessionId: validateCodexSessionId,
  models: {
    list: codexModelCatalog.list,
    cached: codexModelCatalog.cached,
    invalidate: codexModelCatalog.invalidate,
  },
  createTurn: (options) => {
    assertCodexOptions(options.payload.turnOptions);
    const turnOptions = options.payload.turnOptions;
    const config = {
      ...codexAcpLaunch(options.runtime, {
        processEnv: options.processEnv,
        session: {
          disableProviderMemory: options.disableProviderMemory,
          artifactDirectory: options.artifactDirectory,
          approveForMe: turnOptions.permissionMode === "approve-for-me",
          builtinMcp: options.builtinMcp?.server,
          thirdPartyMcpPlan: options.thirdPartyMcpPlan,
          providerSettings: options.backendSessionConfig?.providerSettings,
        },
      }),
      ...codexTurnValues,
    };
    return new BridgedAcpTurn(options, config, requireProviderBridge());
  },
  skills: {
    sources: (workspace) => [
      { path: join(homedir(), ".agents", "skills"), scope: "user" },
      { path: join(homedir(), ".codex", "skills"), scope: "user" },
      { path: join(workspace, ".agents", "skills"), scope: "repo" },
      { path: join(workspace, ".codex", "skills"), scope: "repo" },
      { path: systemSkillsPath(), scope: "system" },
    ],
  },
  setup: {
    latestVersion: () => npmLatestVersion("@openai/codex"),
    selfUpdate: ["update"],
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: { command: "codex update", dangerous: true },
      login: { command: "codex login", dangerous: false },
    },
  },
  headless: {
    purposes: ["title", "install-analysis", "repair", "serve", "subagent"],
    spec: codexHeadlessSpec,
  },
  maintenance: codexMaintenance,
};
