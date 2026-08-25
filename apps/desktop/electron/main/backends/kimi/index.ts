/**
 * [INPUT]: Depends on Registry first-valid flight Kimi CLI candidates/ACP, provider model/Thinking, authorized processEnv, installer, headless/maintenance, buildtinTools oracle and system Skill root
 * [OUTPUT]: Provides kimiBackend: Unified ACP Chat, authorization environment, models, images, Plan, version control tools, runtime discovery and background extensions
 * [POS]: The only installation point for the Kimi descriptor; When running, the registry is handing over the rights and capabilities
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { KimiTurnOptions } from "../../../../shared/agent-ipc";
import { systemSkillsPath } from "../../system-skills";
import { githubLatestVersion } from "../../setup/latest-version";
import { AcpTurn } from "../acp/acp-turn";
import { classifyAcpFailure } from "../acp/failure";
import {
  EFFORT_ID_PATTERN,
  MODEL_ID_PATTERN,
} from "../capability-validation";
import {
  builtinToolsForVersion,
  commonCommandPaths,
  probeRuntimeCandidatesAsync,
  runtimeVersionAtLeast,
} from "../runtime-probe";
import type { BackendDescriptor } from "../types";
import { kimiHeadlessSpec } from "./headless";
import { createKimiMaintenance } from "./maintenance";
import { invalidateKimiModels, listKimiModels } from "./models";
import {
  kimiAcpLaunch,
  kimiEnvironment,
  resolveKimiCodeHome,
  validateKimiSessionId,
} from "./home";
import { createKimiAuthCheck } from "./auth";

const PERMISSIONS = new Set(["ask-for-approval", "approve-for-me"]);
const MINIMUM_VERSION = "0.29.1";
const INSTALL_COMMAND =
  "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash";
export function kimiSkillSources(
  workspace: string,
  systemPath = systemSkillsPath(),
  userHome = homedir(),
  codeHome = resolveKimiCodeHome()
) {
  return [
    { path: join(userHome, ".agents", "skills"), scope: "user" as const },
    { path: join(codeHome, "skills"), scope: "user" as const },
    { path: join(workspace, ".agents", "skills"), scope: "repo" as const },
    { path: join(workspace, ".kimi-code", "skills"), scope: "repo" as const },
    { path: systemPath, scope: "system" as const },
  ];
}

/**
 * Kimi 官方安装器把二进制放进 `~/.kimi-code/bin`，而 GUI 进程继承的 PATH
 * 里没有它——本机能探到全靠登录 shell 那一跳兜住。打包 .app 从 Finder
 * 启动、登录 shell 探测失败时，Kimi 直接不可见。
 *
 * `commonPaths` 是**替换**语义：只写这一条等于把 npm/bun/pnpm/homebrew
 * 那些通用落点全丢掉，用别种装法的机器反而探不到。显式取并集
 * （与 OpenCode 同型，见 opencode/index.ts）。
 */
const findKimiRuntime = (signal?: AbortSignal) =>
  probeRuntimeCandidatesAsync({
    command: "kimi",
    commonPaths: [
      join(homedir(), ".kimi-code/bin/kimi"),
      ...commonCommandPaths("kimi"),
    ],
    signal,
  });
const kimiMaintenance = createKimiMaintenance();

function validate(value: unknown): asserts value is KimiTurnOptions {
  if (!value || typeof value !== "object") {
    throw new Error("Kimi turn 选项不完整");
  }
  const options = value as Partial<KimiTurnOptions>;
  if (options.backend !== "kimi") throw new Error("Kimi 后端判别值无效");
  if (
    options.model !== undefined &&
    (typeof options.model !== "string" || !MODEL_ID_PATTERN.test(options.model))
  ) {
    throw new Error("Kimi 模型格式无效");
  }
  if (
    options.reasoningEffort !== undefined &&
    (typeof options.reasoningEffort !== "string" ||
      !EFFORT_ID_PATTERN.test(options.reasoningEffort))
  ) {
    throw new Error("Kimi Thinking Effort 格式无效");
  }
  if (!PERMISSIONS.has(options.permissionMode ?? "")) {
    throw new Error("Kimi 权限档位无效");
  }
}

// builtinTools 由 oracle 按 runtime 版本推导：实测解锁版 ≥0.29.2 为 mutate，
// 最低支持版 0.29.1 保持 none（fail-closed 语义不破坏）。
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

export const kimiBackend: BackendDescriptor = {
  id: "kimi",
  displayName: "Kimi",
  workspaceDirName: "kimi-workspace",
  detectRuntime: findKimiRuntime,
  // version 探针与 models/turn 同政策：KIMI_CODE_HOME 随 env 漂移时，
  // 探针必须落在同一状态根，否则会在错位目录建目录、落缓存。
  versionEnvironment: kimiEnvironment,
  validateRuntime: (runtime) =>
    runtimeVersionAtLeast(runtime.version, MINIMUM_VERSION)
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `Kimi Code 需要 ${MINIMUM_VERSION} 或更高版本。`,
        },
  capabilitiesFor: (runtime) => ({
    ...capabilities,
    builtinTools: builtinToolsForVersion("kimi", runtime.version),
  }),
  classifyFailure: classifyAcpFailure,
  auth: { check: createKimiAuthCheck() },
  validateTurnOptions: validate,
  validateSessionId: validateKimiSessionId,
  models: {
    list: (runtime, _workspace, signal) => listKimiModels(runtime, signal),
    invalidate: invalidateKimiModels,
  },
  createTurn: (options) => {
    validate(options.payload.turnOptions);
    return new AcpTurn(options, {
      ...kimiAcpLaunch(options.runtime, { processEnv: options.processEnv }),
      validateSessionId: validateKimiSessionId,
      resumeWithoutReplay: true,
      modeValues: {
        default: "default",
        plan: "plan",
        approveForMe: "yolo",
      },
      classifyFailure: kimiBackend.classifyFailure,
      reviewResidualApprovals: true,
    });
  },
  skills: { sources: kimiSkillSources },
  setup: {
    latestVersion: () => githubLatestVersion("MoonshotAI/kimi-code"),
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      login: { command: "kimi", dangerous: false },
    },
  },
  headless: {
    purposes: ["title", "install-analysis", "repair", "serve", "subagent"],
    spec: kimiHeadlessSpec,
  },
  maintenance: kimiMaintenance,
};
