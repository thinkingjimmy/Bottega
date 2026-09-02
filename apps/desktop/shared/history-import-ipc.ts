/**
 * [INPUT]: The sequencing type of shared Agent/Settings only
 * [OUTPUT]: Provides external session identity, fingerprints, canonical routing, adoption, and Memory snapshot contracts
 * [POS]: The single source of truth for the shared history-import wire; the renderer never receives a source file path and cannot forge a SessionRef
 */

import type {
  AgentBackendId,
  AgentTurnOptions,
  AgentUserInput,
} from "./agent-ipc";
import type { ChatAttachmentPayload } from "./chats-ipc";
import type { SubmissionContentV1 } from "./submission";
import type { MemorySharingMode } from "./settings-ipc";

export const HISTORY_SOURCE_KINDS = ["claude", "codex", "kimi", "opencode"] as const;
export type HistorySourceKind = (typeof HISTORY_SOURCE_KINDS)[number];

export type HistoryFileFingerprint = Readonly<{
  device: string;
  inode: string;
  mtimeNs: string;
  size: number;
  parserVersion: number;
}>;

export type HistoryFileState =
  | "new"
  | "append"
  | "truncate"
  | "replace"
  | "archive"
  | "delete"
  | "unchanged";

/** 唯一等价关系；任何去重/claim/resume 都必须消费同一组 alias。 */
export type ExternalSessionKey = Readonly<{
  sourceKind: HistorySourceKind;
  storageFingerprint: string;
  canonicalNativeId: string;
  aliases: string[];
  resumeAlias: string;
}>;

export type ForeignHistorySummary = Readonly<{
  opaqueId: string;
  projectId: string;
  sourceKind: HistorySourceKind;
  key: ExternalSessionKey;
  title: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  historyRevision: string;
  canResume: boolean;
  /** 合成位：源生归档（如 codex archived_sessions）或产品侧归档任一为真。 */
  archived: boolean;
  incompleteTail: boolean;
}>;

export type ForeignToolEvent = Readonly<{
  id: string;
  name: string;
  input?: string;
  output?: string;
}>;

export type ForeignHistoryMessage = Readonly<{
  kind: "message";
  id: string;
  nativeTurnId: string;
  deliverySeq: number;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  tools?: ForeignToolEvent[];
  /** 源自带的 turn 工时账（codex task_complete.duration_ms）；缺席即源无此账（claude），不得推导。 */
  workedForMs?: number;
}>;

export type UnsupportedHistoryBlock = Readonly<{
  kind: "unsupported";
  id: string;
  deliverySeq: number;
  createdAt: number;
  reason: string;
  escapedPreview: string;
}>;

export type ForeignHistoryBlock =
  | ForeignHistoryMessage
  | UnsupportedHistoryBlock;

export type HistorySourceCount = Readonly<{
  sourceKind: HistorySourceKind;
  installed: boolean;
  count: number;
}>;

export type ProjectHistoryImportState = Readonly<{
  projectId: string;
  enabled: boolean;
  memoryImportIntent: boolean;
  detecting: boolean;
  refreshing: boolean;
  /** 本 Project 的内容在已确认 Grant 的后台交付泵里；确认即受理，交付不阻塞 UI。 */
  delivering: boolean;
  hasChanges: boolean;
  generation: number;
  counts: HistorySourceCount[];
}>;

export type HistoryImportSnapshot = Readonly<{
  revision: number;
  entries: ForeignHistorySummary[];
  canonicalRoutes: Readonly<Record<string, Readonly<{
    chatId: string;
    generationId: string;
    summary: ForeignHistorySummary;
  }>>>;
  projects: ProjectHistoryImportState[];
  /** 任一已确认 Memory Grant 仍在后台交付（含 product-only，无 Project 可挂靠的场景）。 */
  memoryDelivering: boolean;
  warning: string | null;
}>;

/** prepare 只冻结目录与令牌；计数经 countProject 异步补齐，弹窗不等扫描。 */
export type PreparedProjectHistoryImport = Readonly<{
  token: string;
  canonicalRoot: string;
  name: string;
  expiresAt: number;
}>;

export type HistoryMemoryEligibility = Readonly<{
  visible: boolean;
  enabled: boolean;
  sharingMode: MemorySharingMode;
  reason: "ready" | "memory-unavailable" | "chat-mode" | "history-disabled";
  interruptedGrant: boolean;
}>;

/* ── 续聊首轮与产品首轮同构 ──────────────────────────────────────
 * 这里曾只有一个 `message: string`，于是 main 只能把它硬拼成
 * `input:[{type:"text"}]`、`files:[]`——续聊首轮因此天生比产品首轮少一截：
 * 图片附件与 Plan 送不出去，输入框上那个「+」也就只能整枚藏起来。
 * 契约改收 renderer 已经装配好的四件套后，两条路在 wire 上就是同一张脸；
 * main 仍然只补它独有的那部分（entry/snapshot/importOrigin 与 adopt
 * persistence），renderer 依旧构造不出 SessionRef adopt，主权边界一寸未移。
 * ────────────────────────────────────────────────────────── */
export type HistoryAdoptionSubmission = Readonly<{
  /** 结构化 wire input；与 content.richValue 的投影必须逐项同构。 */
  input: AgentUserInput[];
  /** 用户消息正文；与 content.displayText trim 后必须一致。 */
  displayText: string;
  attachmentPayloads?: ChatAttachmentPayload[];
  content: SubmissionContentV1;
  planMode?: boolean;
}>;

export type PrepareHistoryAdoptionInput = Readonly<{
  opaqueId: string;
  expectedHistoryRevision: string;
  submission: HistoryAdoptionSubmission;
  turnOptions: AgentTurnOptions;
}>;

export type HistoryAdoptionReceipt = Readonly<{
  chatId: string;
  incarnationId: string;
  phase: "started" | "queued" | "settled";
}>;

export type HistoryMemoryPreview = Readonly<{
  snapshotId: string;
  digest: string;
  chats: number;
  turns: number;
  from: number | null;
  to: number | null;
  sharingMode: MemorySharingMode;
  includesForeign: boolean;
  expiresAt: number;
}>;

export type ProjectHistoryCommitResult = Readonly<{
  project: import("./projects-ipc").Project;
  memoryPreview: HistoryMemoryPreview | null;
}>;

export type ProjectHistoryRefreshResult = Readonly<{
  project: ProjectHistoryImportState;
  memoryPreview: HistoryMemoryPreview | null;
}>;

export type HistoryImportEvent =
  | { type: "snapshot"; snapshot: HistoryImportSnapshot }
  | { type: "project"; project: ProjectHistoryImportState };

export const HISTORY_IMPORT_CHANNEL = {
  snapshot: "history-import:snapshot",
  prepareProject: "history-import:project:prepare",
  countProject: "history-import:project:counts",
  commitProject: "history-import:project:commit",
  setProjectEnabled: "history-import:project:set-enabled",
  refreshProject: "history-import:project:refresh",
  adopt: "history-import:adopt",
  memoryEligibility: "history-import:memory:eligibility",
  memoryPreview: "history-import:memory:preview",
  memoryCommit: "history-import:memory:commit",
  event: "history-import:event",
} as const;

export type HistoryImportBridgeApi = {
  snapshot(): Promise<HistoryImportSnapshot>;
  prepareProject(): Promise<PreparedProjectHistoryImport | null>;
  countProject(token: string): Promise<HistorySourceCount[]>;
  commitProject(input: {
    token: string;
    importHistory: boolean;
    previewMemory: boolean;
  }): Promise<ProjectHistoryCommitResult>;
  setProjectEnabled(projectId: string, enabled: boolean): Promise<void>;
  refreshProject(projectId: string): Promise<ProjectHistoryRefreshResult>;
  adopt(input: PrepareHistoryAdoptionInput): Promise<HistoryAdoptionReceipt>;
  memoryEligibility(input: {
    surface: "project" | "settings";
    projectId?: string;
  }): Promise<HistoryMemoryEligibility>;
  memoryPreview(input: {
    projectId?: string;
    includeProductChats: boolean;
  }): Promise<HistoryMemoryPreview>;
  memoryCommit(snapshotId: string, digest: string): Promise<void>;
  onEvent(callback: (event: HistoryImportEvent) => void): () => void;
};

export function sessionAliases(key: ExternalSessionKey) {
  return new Set([key.canonicalNativeId, key.resumeAlias, ...key.aliases]);
}

export function historyBackend(source: HistorySourceKind): AgentBackendId {
  return source;
}
