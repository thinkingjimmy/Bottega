/**
 * [INPUT]: Depends on Node path plus the shared Apps/Agent install DTOs it validates
 * [OUTPUT]: Provides the single `isContained` path fence, the credential-stripping login shell, `assertAddAppInput`, `createInstallingAppRecord`, and a re-exported `normalizeGithubRepoUrl`
 * [POS]: The apps module's only cross-cutting helper leaf; every caller shares one containment rule instead of a private copy, while status broadcast stays with AppStore.watch and error normalization with main/errors.ts
 */

import { isAbsolute, relative, sep } from "node:path";
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
    pinnedAt: null,
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
    editableSource: true,
    skillStatus: null,
    addedAt: input.addedAt,
  };
}

/**
 * target 是否被 root 目录围栏包含（含相等），防路径逃逸。
 *
 * 逃逸的判据是「第一个路径段就是 ..」，不是「字符串以 .. 开头」：root 下一个
 * 名叫 `..foo` 的兄弟目录，relative() 给出的正是 `..foo`，前缀匹配会把它误判
 * 成越界并拒绝一个完全合法的路径。因此只认 `..${sep}` 与恰好等于 `..` 两形。
 */
export const isContained = (root: string, target: string) => {
  const path = relative(root, target);
  if (path === "") return true;
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
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
