/**
 * [INPUT]: Uses native CLI discovery, bb-native-v1 RPC/policy admission, the pinned Provider bridge, model/auth/quota controls and the recommended installer reference.
 * [OUTPUT]: Exports codexBackend with version-independent ordinary Chat, native RPC/policy admission, models, quota, optional updates and separate qualified native title/candidate factories; ordinary Chat refuses isolated roles.
 * [POS]: Codex composition boundary; all subprocesses retain main authorization and custody.
 */

import { codexQuota } from "./quota";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodexTurnOptions } from "../../../../shared/ipc/agent/codex-ipc";
import { systemSkillsPath } from "../../skills/catalog/system-skills";
import { SUPPORTED_CODEX_VERSION } from "./version";
import { codexEnvironment, codexHomePath, findCodexRuntime } from "./environment";
import { nativeFailure } from "./native/mapping/failure";
import { BridgedTurn } from "../host/turns/bridged-turn";
import { requireProviderBridge } from "../host/runtime";
import {
  MODEL_ID_PATTERN,
  OPAQUE_CONFIG_VALUE_PATTERN,
} from "../../backends/runtime/capability-validation";
import {
  builtinToolsForVersion,
} from "../../backends/runtime/runtime-probe";
import type { BackendDescriptor } from "../../backends/contracts/types";
import { codexModels } from "./background/catalog";
import { nativeCodexLaunch } from "./native/policy/spawn";
import { validateCodexSessionId } from "./native/policy/session-id";
import { checkCodexAuth, codexRoute } from "./auth";
import { SESSION_CAPABILITY_POLICY } from "../../backends/acp/startup/client-capabilities";

const PERMISSION_MODES = new Set([
  "ask-for-approval",
  "approve-for-me",
  "full-access",
]);

const INSTALL_COMMAND =
  `curl -fsSL https://chatgpt.com/codex/install.sh | sh -s -- --release ${SUPPORTED_CODEX_VERSION}`;
/* Installation and sign-in remain separate product states. */
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

// Tool availability still comes from the runtime oracle; strict roles require separate admission.
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
  headless: [],
  candidateEditing: "native-candidate/v1",
  maintenance: false,
};

export const codexBackend: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",
  workspaceDirName: "codex-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.codex,
  quota: codexQuota,
  serviceTier: { configOptionId: "service-tier", values: { default: "default", priority: "priority" } },
  detectRuntime: findCodexRuntime,
  // Version probes and execution use the same normalized state root.
  versionEnvironment: codexEnvironment,
  validateRuntime: () => ({ status: "installed" }),
  capabilitiesFor: (runtime) => ({
    ...capabilities,
    candidateEditing: runtime.version.replace(/^codex-cli\s+/, "") === SUPPORTED_CODEX_VERSION ? capabilities.candidateEditing : undefined,
    builtinTools: builtinToolsForVersion("codex", runtime.version),
  }),
  classifyFailure: cause => nativeFailure(cause),
  auth: {
    check: checkCodexAuth,
    route: codexRoute,
  },
  readiness: async (runtime) => ({ launch: nativeCodexLaunch(runtime, homedir()) }),
  validateTurnOptions: assertCodexOptions,
  validateSessionId: validateCodexSessionId,
  models: {
    list: codexModels.list,
    cached: codexModels.cached,
    invalidate: codexModels.invalidate,
  },
  createTurn: (options) => {
    if (options.artifactCandidate) throw new Error("An isolated candidate must use its candidate factory");
    if (options.titleOnly) throw new Error("A native title must use its title factory");
    assertCodexOptions(options.payload.turnOptions);
    return new BridgedTurn(options, {
      protocol: "codex-app-server",
      env: codexEnvironment(options.runtime),
      prepare: async () => (await import("./native/policy/launch")).nativeCodexTurnPlan(options),
    }, requireProviderBridge());
  },
  createTitleTurn: (options) => {
    if (!options.titleOnly) throw new Error("Title execution requires its independent purpose");
    assertCodexOptions(options.payload.turnOptions);
    return new BridgedTurn(options, {
      protocol: "codex-app-server", env: codexEnvironment(options.runtime),
      prepare: async () => (await import("./native/policy/isolated/title-plan")).nativeTitleTurnPlan(options),
    }, requireProviderBridge());
  },
  createCandidateTurn: (options) => {
    if (!options.artifactCandidate) throw new Error("Candidate execution requires its independent purpose");
    assertCodexOptions(options.payload.turnOptions);
    return new BridgedTurn(options, {
      protocol: "codex-app-server",
      env: codexEnvironment(options.runtime),
      prepare: async () => (await import("./native/policy/candidate-plan")).nativeCandidateTurnPlan(options),
    }, requireProviderBridge());
  },
  skills: {
    sources: (workspace) => [
      { path: join(homedir(), ".agents", "skills"), scope: "user" },
      { path: join(codexHomePath(), "skills"), scope: "user" },
      { path: join(workspace, ".agents", "skills"), scope: "repo" },
      { path: join(workspace, ".codex", "skills"), scope: "repo" },
      { path: systemSkillsPath(), scope: "system" },
    ],
  },
  setup: {
    latestVersion: async () => SUPPORTED_CODEX_VERSION,
    updateCommand: { command: "/bin/sh", args: ["-c", `curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh -s -- --release ${SUPPORTED_CODEX_VERSION}`] },
    commands: {
      install: {
        command: INSTALL_COMMAND,
        dangerous: true,
      },
      update: { command: INSTALL_COMMAND, dangerous: true },
      login: { command: "codex login", dangerous: false },
    },
  },
  maintenance: {
    open: async context => (await import("./background/maintenance")).codexMaintenance.open(context),
    cleanup: async context => (await import("./background/maintenance")).codexMaintenance.cleanup?.(context),
  },
};
