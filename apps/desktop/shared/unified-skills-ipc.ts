/**
 * [INPUT]: type-only depending on the four-end identity of agent-ipc; No Node/Electron side effects
 * [OUTPUT]: Provides a unified Skills library, candidates, four unincorporated bytes, four-tiered execution mode, explicit drift recovery, precise authority, localisable reasoning/error codes, cross-source name-taken, and a renderer bridge contract
 * [POS]: The goal of the project is to improve the quality of the communication between the parties and the partiesAbsolute path, real HOME, staging/backup path with native error loading never comes out main
 */

import type { AgentBackendId } from "./agent-ipc";

export type ManagedSkillAgent = AgentBackendId;
export type ManagedSkillAction = "project" | "takeover" | "remove" | "recover";
/**
 * `local-folder` 没有产品入口：本地文件夹导入的 UI、client、IPC 通道与
 * handler 已一并撤除。它留在这里有两个理由——已入库条目的 provenance
 * 要读得回来，且主进程的 folder 导入仍是 durable 测试唯一能造出「来源
 * 不属于任何 Agent 目录」的种子（四家同时 absent、同名不同来源 409、
 * `skills/<name>` 布局归一三处覆盖都只有它能造）。
 */
export type ManagedSkillSourceKind = "github" | "local-folder" | "adopted";
export type ManagedSkillNativeState = boolean | "unknown";
export type ManagedSkillProductState = boolean | "not-applicable" | "unknown";

/* ── 不可收编的理由是码，不是句子 ──────────────────────────────────
 * 这些理由从 main 的文件系统勘察里长出来，却要落在五种语言的界面上。
 * 从前它们是 main 侧硬编码的中文串，于是英文界面里赫然躺着「Skill 文件
 * 超过 1 MiB」——不是翻译漏了，是句子根本没经过目录。
 * 码留在 main（分支与日志的坐标），话交给 renderer（人读的那一半）。
 * detail 只放 Skill 内部的相对路径：它本就属于用户交出来的那棵树，
 * 与「绝对路径永不出 main」的边界不冲突。
 * ────────────────────────────────────────────────────────────── */
export type ManagedSkillReasonCode =
  | "missing-skill-md"
  | "invalid-frontmatter"
  | "invalid-name"
  | "skill-md-too-large"
  | "too-many-directories"
  | "too-many-candidates"
  | "symlink"
  | "unsafe-path"
  | "not-a-directory"
  | "unreadable"
  | "missing"
  | "changed"
  | "timeout"
  /* 库里一个 name 只对应一个来源身份。跨四家同名是常态，所以这不是
     错误而是「这一条收不进来」的一个理由——判断提在预览，409 便没有
     机会发生。 */
  | "name-taken"
  | "unknown";

export type ManagedSkillReason = Readonly<{
  code: ManagedSkillReasonCode;
  detail?: string;
}>;

/* 操作失败同理：registrar 早已把一切收敛成三种公开结局，
   但那三句话也是中文常量。收敛成三个码，翻译才有落点。 */
export const UNIFIED_SKILLS_ERROR = {
  conflict: "unified-skills/conflict",
  readOnly: "unified-skills/read-only",
  failed: "unified-skills/failed",
} as const;

export type UnifiedSkillsErrorCode =
  (typeof UNIFIED_SKILLS_ERROR)[keyof typeof UNIFIED_SKILLS_ERROR];

export type ManagedSkillVisibility = Readonly<{
  agent: ManagedSkillAgent;
  surface: "product-and-terminal" | "terminal-only";
}>;

export type ManagedSkillLayerState = Readonly<{
  present: boolean;
  nativeEnabled: ManagedSkillNativeState;
  productEnabled: ManagedSkillProductState;
  sessionVisible: boolean | "unknown";
  ownership: "absent" | "foreign" | "imported-source" | "managed-projection";
  recovery: "none" | "move-foreign-target" | "ready";
}>;

export type ManagedSkillTargetView = Readonly<{
  agent: ManagedSkillAgent;
  targetId: string;
  label: string;
  deprecated: boolean;
  visibleTo: readonly ManagedSkillVisibility[];
  state: ManagedSkillLayerState;
}>;

export type ManagedSkillLibraryItem = Readonly<{
  ref: string;
  name: string;
  displayName: string;
  description: string;
  digest: `sha256:${string}`;
  source: Readonly<{
    kind: ManagedSkillSourceKind;
    label: string;
    generation: number;
  }>;
  targets: readonly ManagedSkillTargetView[];
}>;

export type ManagedSkillCandidate = Readonly<{
  ref: string;
  agent: ManagedSkillAgent | "local-folder";
  name: string;
  displayName: string;
  description: string;
  digest: `sha256:${string}` | null;
  revision: string;
  /* 体积如实上报，好让人在「复制进库 + 最多四个 HOME」之前自己判断；
     它不是准入条件——超大只是超大，不是错误。 */
  files: number;
  bytes: number;
  importable: boolean;
  reason: ManagedSkillReason | null;
  preview: string;
}>;

export type ManagedSkillCandidateError = Readonly<{
  agent: ManagedSkillAgent;
  label: string;
  reason: ManagedSkillReason;
}>;

export type UnifiedSkillsSnapshot = Readonly<{
  revision: number;
  availability:
    | Readonly<{ kind: "ready" }>
    | Readonly<{ kind: "read-only"; reason: ManagedSkillReason }>;
  library: readonly ManagedSkillLibraryItem[];
  candidates: Readonly<{
    revision: string;
    unmanagedByAgent: Readonly<Record<ManagedSkillAgent, number>>;
    /* 四家未纳管合计字节。导入不是「读一下」，是复制进库再按 agent 复制进
       最多四个 HOME——这个数必须在按下「全部导入」之前看得见。 */
    unmanagedBytes: number;
    errors: readonly ManagedSkillCandidateError[];
  }>;
  onboarding: Readonly<{ visible: boolean; totalUnmanaged: number; codexUnmanaged: number }>;
}>;

export type ManagedSkillImportPreview = Readonly<{
  previewId: string;
  revision: string;
  source: ManagedSkillAgent | "local-folder";
  candidates: readonly ManagedSkillCandidate[];
}>;

export type ManagedSkillActionPreview = Readonly<{
  previewId: string;
  expectedRevision: number;
  action: ManagedSkillAction;
  agent: ManagedSkillAgent;
  skillRef: string;
  skillName: string;
  component: string;
  target: string;
  digest: `sha256:${string}`;
  visibleTo: readonly ManagedSkillVisibility[];
  warning: "claude-product-surface" | "coupled-target" | "global-filesystem";
}>;

export type ManagedSkillAuthority = Readonly<{
  authorityToken: string;
  expiresAt: number;
}>;

export const UNIFIED_SKILLS_CHANNEL = {
  list: "unified-skills:list",
  candidates: "unified-skills:candidates",
  import: "unified-skills:import",
  previewAction: "unified-skills:preview-action",
  authorizeAction: "unified-skills:authorize-action",
  applyAction: "unified-skills:apply-action",
  setProduct: "unified-skills:set-product",
  dismissOnboarding: "unified-skills:dismiss-onboarding",
  changed: "unified-skills:changed",
} as const;

export type UnifiedSkillsBridgeApi = {
  list(forceReload?: boolean): Promise<UnifiedSkillsSnapshot>;
  candidates(agent: ManagedSkillAgent, forceReload?: boolean): Promise<ManagedSkillImportPreview>;
  import(input: Readonly<{ previewId: string; revision: string; candidateRefs: readonly string[] }>): Promise<UnifiedSkillsSnapshot>;
  previewAction(input: Readonly<{
    skillRef: string;
    agent: ManagedSkillAgent;
    action: ManagedSkillAction;
    expectedRevision: number;
  }>): Promise<ManagedSkillActionPreview>;
  authorizeAction(previewId: string): Promise<ManagedSkillAuthority>;
  applyAction(input: Readonly<{
    previewId: string;
    authorityToken: string;
    expectedRevision: number;
  }>): Promise<UnifiedSkillsSnapshot>;
  setProduct(input: Readonly<{ skillRef: string; enabled: boolean; expectedRevision: number }>): Promise<UnifiedSkillsSnapshot>;
  dismissOnboarding(): Promise<UnifiedSkillsSnapshot>;
  onChanged(callback: (snapshot: UnifiedSkillsSnapshot) => void): () => void;
};
