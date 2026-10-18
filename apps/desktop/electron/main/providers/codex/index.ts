/**
 * [INPUT]: Uses validated native CLI discovery, bb-native-v1 launch policy, the pinned Provider bridge and model/auth/quota controls and the pinned official installer target.
 * [OUTPUT]: Exports codexBackend with exact-version native Chat, readiness, model options, quota and strict-role admission.
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
  maintenance: false,
};

export const codexBackend: BackendDescriptor = {
  id: "codex",
  displayName: "Codex",
  minimumVersion: SUPPORTED_CODEX_VERSION,
  workspaceDirName: "codex-workspace",
  sessionCapabilityPolicy: SESSION_CAPABILITY_POLICY.codex,
  quota: codexQuota,
  serviceTier: { configOptionId: "service-tier", values: { default: "default", priority: "priority" } },
  detectRuntime: findCodexRuntime,
  // Version probes and execution use the same normalized state root.
  versionEnvironment: codexEnvironment,
  validateRuntime: (runtime) =>
    runtime.version.replace(/^codex-cli\s+/, "") === SUPPORTED_CODEX_VERSION
      ? { status: "installed" }
      : {
          status: "unsupported",
          reason: `This native integration supports Codex CLI ${SUPPORTED_CODEX_VERSION} only. Recheck after installing that version.`,
        },
  capabilitiesFor: (runtime) => ({
    ...capabilities,
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
    assertCodexOptions(options.payload.turnOptions);
    return new BridgedTurn(options, {
      protocol: "codex-app-server",
      env: codexEnvironment(options.runtime),
      prepare: async () => (await import("./native/policy/launch")).nativeCodexTurnPlan(options),
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
    updatePolicy: "exact",
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
