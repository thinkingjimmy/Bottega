/**
 * [INPUT]: Depends on Node path/crypto plus the shared Apps/Agent install DTOs it validates
 * [OUTPUT]: Provides the single `isContained` path fence, the credential-stripping login shell, `assertAddAppInput`, `createInstallingAppRecord`, the `appDigest` identity hash, the `AppRoutingFacts` derivation, and a re-exported `normalizeGithubRepoUrl`
 * [POS]: The apps module's only cross-cutting helper leaf; every caller shares one containment rule and one identity hash instead of private copies, while status broadcast stays with AppStore.watch and error normalization with main/errors.ts
 */

import { createHash } from "node:crypto";
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

// ============================================================
// 纯派生：App 的持久身份摘要与路由事实
// ============================================================

/** App 持久身份的唯一摘要算法；turn 快照与删除归档共用，避免两套身份。 */
export function appDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

/** 路由判定只需要的那几条事实；不含 manifest/receipt，交出去也改不动真相。 */
export type AppRoutingFacts = Readonly<{
  lifecycleRevision: number;
  activeGenerationId: string | null;
  activeContentDigest: string | null;
  pendingGeneration: boolean;
  draining: ReadonlySet<string>;
  generationIds: ReadonlySet<string>;
}>;

/* 记录在 Store 里是按对象整体替换的：每次提交都换一个新对象，所以按对象身份
   记忆就等于「记录一变即失效」，不需要任何显式清除通道，也不会拖住旧记录。 */
const routingFactsByRecord = new WeakMap<AppRecord, AppRoutingFacts>();

/** 直接从记录派生路由事实——不做 structuredClone，同一条记录只算一次。 */
export function appRoutingFacts(record: AppRecord): AppRoutingFacts {
  const cached = routingFactsByRecord.get(record);
  if (cached) return cached;
  const active = record.generationBinding.active;
  const facts: AppRoutingFacts = {
    lifecycleRevision: record.lifecycleRevision,
    activeGenerationId: active?.generationId ?? null,
    activeContentDigest:
      record.generations.find(
        (generation) => generation.generationId === active?.generationId
      )?.contentDigest ?? null,
    pendingGeneration: Boolean(record.generationBinding.pending),
    draining: new Set(record.generationBinding.drainingGenerationIds),
    generationIds: new Set(
      record.generations.map((generation) => generation.generationId)
    ),
  };
  routingFactsByRecord.set(record, facts);
  return facts;
}
