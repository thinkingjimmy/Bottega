/**
 * [INPUT]: Depends on Agent identities and the shared ProductResult envelope
 * [OUTPUT]: Provides the pathless Library-first Skills contract for sources, enablement, allowed actions, deletion consent, durable jobs, onboarding facts, and renderer IPC
 * [POS]: Single Skills management wire truth; no native target, projection, filesystem path, or terminal-facing action can cross this boundary
 */

import type { AgentBackendId } from "./agent-ipc";
import type { ProductResult } from "./product-failure";

export type ManagedSkillAgent = AgentBackendId;
export type ManagedSkillSourceKind = "local-folder" | "adopted" | "extension";
export type ManagedSkillImportSource = ManagedSkillAgent | "local-folder" | "all";
export type ManagedSkillAllowedAction =
  | "delete"
  | "disable"
  | "enable"
  | "goto-package";

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
  | "name-taken"
  | "name-taken-same"
  | "name-taken-differs"
  | "source-gone"
  | "postcondition-changed"
  | "acquisition-failed"
  | "ref-invalid"
  | "unknown";

export type ManagedSkillReason = Readonly<{
  code: ManagedSkillReasonCode;
  detail?: string;
}>;

export type ManagedSkillLibraryItem = Readonly<{
  ref: string;
  name: string;
  displayName: string;
  description: string;
  requires?: string;
  digest: `sha256:${string}`;
  source: Readonly<{
    kind: ManagedSkillSourceKind;
    label: string;
    generation: number;
    installIdentity?: string;
    componentInstanceIdentity?: string;
    active: boolean;
  }>;
  enabled: boolean;
  allowedActions: readonly ManagedSkillAllowedAction[];
}>;

export type ManagedSkillCandidateStatus =
  | "new"
  | "update"
  | "current"
  | "blocked";

export type ManagedSkillCandidate = Readonly<{
  ref: string;
  agent: ManagedSkillAgent | "local-folder";
  name: string;
  displayName: string;
  description: string;
  digest: `sha256:${string}` | null;
  revision: string;
  files: number;
  bytes: number;
  status: ManagedSkillCandidateStatus;
  importable: boolean;
  reason: ManagedSkillReason | null;
  preview: string;
}>;

export type ManagedSkillCandidateError = Readonly<{
  agent: ManagedSkillAgent | "local-folder";
  label: string;
  reason: ManagedSkillReason;
}>;

export type ManagedSkillSourceStatus =
  | "ok"
  | "missing"
  | "not-installed"
  | "failed";
export type ManagedSkillSourceView = Readonly<{
  source: ManagedSkillAgent | "local-folder";
  status: ManagedSkillSourceStatus;
  actionable: number;
  current: number;
  bytes: number;
  errors: readonly ManagedSkillCandidateError[];
}>;

export type ManagedSkillJobIssue = Readonly<{
  skillName: string;
  reason: ManagedSkillReason;
}>;

export type ManagedSkillTerminalReport = Readonly<{
  batchId: string;
  finishedAt: number;
  acquisition: Readonly<{
    created: number;
    updated: number;
    unchanged: number;
  }>;
  enablement: Readonly<{ enabled: number; disabled: number }>;
  deleted: number;
  issues: readonly ManagedSkillJobIssue[];
  affectedSkillRefs: readonly string[];
  undoToken?: string;
}>;

export type ManagedSkillJobProgress = Readonly<{
  batchId: string;
  status:
    | "authorized"
    | "running"
    | "completed"
    | "completed-with-failures"
    | "failed"
    | "undo-running"
    | "undone"
    | "abandoned";
  processed: number;
  total: number;
  report: ManagedSkillTerminalReport | null;
}>;

export type UnifiedSkillsSnapshot = Readonly<{
  revision: number;
  availability:
    | Readonly<{ kind: "initializing" }>
    | Readonly<{ kind: "ready" }>
    | Readonly<{ kind: "read-only"; reason: ManagedSkillReason }>;
  library: readonly ManagedSkillLibraryItem[];
  sources: readonly ManagedSkillSourceView[];
  candidates: Readonly<{
    revision: string;
    unmanagedByAgent: Readonly<Record<ManagedSkillAgent, number>>;
    upToDateByAgent: Readonly<Record<ManagedSkillAgent, number>>;
    unmanagedBytes: number;
    errors: readonly ManagedSkillCandidateError[];
  }>;
  latestJob: ManagedSkillJobProgress | null;
  personalLibraryEmpty: boolean;
  enabledLibraryCount: number;
  enabledLibraryPromptBytes: number;
}>;

export type ManagedSkillImportPreview = Readonly<{
  previewId: string;
  revision: string;
  source: ManagedSkillImportSource;
  candidates: readonly ManagedSkillCandidate[];
  errors: readonly ManagedSkillCandidateError[];
}>;

export type ManagedSkillIntentInput =
  | Readonly<{ type: "set-enabled"; skillRef: string; enabled: boolean }>
  | Readonly<{ type: "delete"; skillRef: string }>
  | Readonly<{
      type: "import-and-enable";
      previewId: string;
      revision: string;
      candidateRefs: readonly string[];
    }>;

export type ManagedSkillConsent = Readonly<{
  kind: "delete";
  count: number;
}>;

export type ManagedSkillPlanPreview = Readonly<{
  planId: string;
  planDigest: `sha256:${string}`;
  authorityToken: string;
  expiresAt: number;
  expectedRevision: number;
  consent: readonly ManagedSkillConsent[];
  total: number;
  acquisitionActions: number;
  enablementActions: number;
  deletionActions: number;
}>;

export type ManagedSkillImportOutcome = "created" | "updated" | "unchanged";

export const UNIFIED_SKILLS_CHANNEL = {
  list: "unified-skills:list",
  candidates: "unified-skills:candidates",
  chooseLocal: "unified-skills:choose-local",
  previewIntents: "unified-skills:preview-intents",
  applyPlan: "unified-skills:apply-plan",
  undoPlan: "unified-skills:undo-plan",
  changed: "unified-skills:changed",
  progress: "unified-skills:progress",
} as const;

export type UnifiedSkillsBridgeApi = {
  list(forceReload?: boolean): Promise<ProductResult<UnifiedSkillsSnapshot>>;
  candidates(
    source: ManagedSkillAgent | "all",
    forceReload?: boolean
  ): Promise<ProductResult<ManagedSkillImportPreview>>;
  chooseLocal(): Promise<ProductResult<ManagedSkillImportPreview | null>>;
  previewIntents(
    intents: readonly ManagedSkillIntentInput[]
  ): Promise<ProductResult<ManagedSkillPlanPreview>>;
  applyPlan(input: Readonly<{
    planId: string;
    planDigest: `sha256:${string}`;
    authorityToken: string;
  }>): Promise<ProductResult<UnifiedSkillsSnapshot>>;
  undoPlan(undoToken: string): Promise<ProductResult<UnifiedSkillsSnapshot>>;
  onChanged(callback: (snapshot: UnifiedSkillsSnapshot) => void): () => void;
  onProgress(callback: (progress: ManagedSkillJobProgress) => void): () => void;
};
