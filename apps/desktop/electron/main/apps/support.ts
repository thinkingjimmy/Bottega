/**
 * [INPUT]: Depends on Node path/crypto/fs, the shared Sha256Digest shape, and shared App install/Agent input contracts
 * [OUTPUT]: Provides containment, strict install-mode admission, consent-free declared-install seeds, stable App identity projections, the sha256/canonicalJson/canonicalDigest primitives, and the isDirectory/syncDirectory filesystem primitives
 * [POS]: The apps module's only cross-cutting helper leaf; every caller shares one containment rule and one identity hash instead of private copies, while status broadcast stays with AppStore.watch and error normalization with main/errors.ts
 */

import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { type AddAppInput, type AppRecord } from "../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../shared/extensions-ipc";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
} from "../../../shared/agent-ipc";

export function assertAddAppInput(value: unknown): AddAppInput {
  if (!value || typeof value !== "object") throw new Error("App 添加参数无效");
  const input = value as Partial<AddAppInput>;
  if (
    typeof input.repoUrl !== "string" ||
    (input.candidateCommitSha !== undefined && (typeof input.candidateCommitSha !== "string" || !/^[0-9a-f]{40}$/.test(input.candidateCommitSha))) ||
    (input.installStrategy !== undefined && !["author-manifest", "agent-analysis"].includes(input.installStrategy)) ||
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
  maintenance: { id: AgentBackendId; version?: string } | null;
  agent?: AgentBackendId;
  installStrategy?: AddAppInput["installStrategy"];
  addedAt: number;
  installCandidate?: AppRecord["installCandidate"];
}): AppRecord {
  return {
    id: input.id,
    sourceRepoUrl: input.repoUrl,
    ...(input.installCandidate ? { installCandidate: input.installCandidate } : {}),
    publishedRepoUrl: null,
    origin: "github",
    displayName: input.displayName,
    dir: input.dir,
    state: "installing",
    lastError: null,
    agentWarning: null,
    agent: input.agent ?? input.maintenance?.id ?? "codex",
    maintenanceAgent: input.maintenance?.id ?? "auto",
    installStrategy: input.installStrategy ?? "author-manifest",
    headlessConsent: input.maintenance && input.installStrategy === "agent-analysis" ? {
      backend: input.maintenance.id,
      version: input.maintenance.version,
      consentAt: input.addedAt,
    } : null,
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
// 纯派生：App 的持久身份摘要与路由事实
// ============================================================

/** App 持久身份的唯一摘要算法；turn 快照与删除归档共用，避免两套身份。 */
export function appDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

/** 路由判定只需要的那几条事实；不含 manifest/receipt，交出去也改不动真相。 */
type AppRoutingFacts = Readonly<{
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

// ============================================================
// Shared digest primitives: one byte-ordered canonical form and one SHA-256 shape
// ============================================================

export function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Byte-ordered keys (never localeCompare) so the same value hashes identically
 * on every machine; `undefined` members are dropped like JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    entries.sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function canonicalDigest(value: unknown): Sha256Digest {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

// ============================================================
// Shared filesystem primitives: directory probe and directory fsync
// ============================================================

/** Missing or unreadable paths read as "not a directory"; callers that must distinguish ENOENT inspect stat themselves. */
export function isDirectory(path: string) {
  return stat(path).then((entry) => entry.isDirectory(), () => false);
}

export { syncDirectory } from "../persistence/durable-json";
