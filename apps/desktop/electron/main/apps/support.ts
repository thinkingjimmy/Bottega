/**
 * [INPUT]: Depends on Node path, Shared Apps/Agent DTO and the credible parameters of the installed input
 * [OUTPUT]: Provides path/environment assistants, GitHub URLs and AddApp authentication, and initial AppRecord builds
 * [POS]: The only source of the cross-assistant of the apps module is the installation of access/path fences/environmental stripping; status broadcasting belongs to AppStore.watch, not to a helper each caller must remember; Error is in the main/errors.ts
 */

import { isAbsolute, relative } from "node:path";
import { type AddAppInput, type AppRecord } from "../../../shared/apps-ipc";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../shared/agent-ipc";

// 归一化单源在 shared/github-repo；这里保留 apps 模块内的既有引用路径


export { normalizeGithubRepoUrl } from "../../../shared/github-repo";

export function assertAddAppInput(value: unknown): AddAppInput {
  if (!value || typeof value !== "object") throw new Error("App 添加参数无效");
  const input = value as Partial<AddAppInput>;
  if (
    typeof input.repoUrl !== "string" ||
    !(
      input.maintenanceAgent === "auto" ||
      AGENT_BACKEND_ORDER.some((id) => id === input.maintenanceAgent)
    )
  ) {
    throw new Error("App 添加参数无效");
  }
  return input as AddAppInput;
}

export function createInstallingAppRecord(input: {
  id: string;
  dir: string;
  repoUrl: string;
  displayName: string;
  maintenance: { id: AgentBackendId; version?: string };
  addedAt: number;
}): AppRecord {
  return {
    id: input.id,
    sourceRepoUrl: input.repoUrl,
    publishedRepoUrl: null,
    origin: "github",
    displayName: input.displayName,
    dir: input.dir,
    state: "installing",
    lastError: null,
    agentWarning: null,
    agent: input.maintenance.id,
    maintenanceAgent: input.maintenance.id,
    headlessConsent: {
      backend: input.maintenance.id,
      version: input.maintenance.version,
      consentAt: input.addedAt,
    },
    bindingRevision: 0,
    lifecycleRevision: 0,
    defaultGrant: null,
    defaultGrantRevision: 0,
    domainIdentity: null,
    generations: [],
    generationBinding: {
      bindingRevision: 0,
      active: null,
      drainingGenerationIds: [],
    },
    manifest: null,
    editChatSlot: null,
    activeUseChatSlot: null,
    skillStatus: null,
    addedAt: input.addedAt,
  };
}

/** target 是否被 root 目录围栏包含（含相等），防路径逃逸。 */
export const isContained = (root: string, target: string) => {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

// ============================================================
// 第三方命令一律先剥离 Codex/OpenAI 凭证，防止环境泄漏
// ============================================================

const STRIP_SENSITIVE_ENV =
  "unset CODEX_HOME CODEX_API_KEY OPENAI_API_KEY OPENAI_ORG_ID OPENAI_PROJECT_ID";

/** 构造登录 shell 命令：凭证剥离前缀 + 用户命令，唯一拼装点。 */
export const strippedShell = (command: string) => ({
  executable: "/bin/zsh",
  args: ["-lc", `${STRIP_SENSITIVE_ENV}\n${command}`],
});
