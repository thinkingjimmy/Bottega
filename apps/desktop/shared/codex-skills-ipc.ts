/**
 * [INPUT]: No Node/Electron dependence; Only accepting main opaque skill ref, revision and one-time authoritative writing
 * [OUTPUT]: Provides Codex's original Skills engine main internal snapshot, layered start, budget summary with preview→authority→mutation
 * [POS]: The Codex Skill is a shared native languageThe old independent renderer is retired, Unified Skills service consumes it and does not expose the renderer to absolute paths, user configurations or app-server original errors
 */

export type CodexSkillRoot = "agents" | "codex" | "admin" | "other";

export type CodexSkillLayerState = Readonly<{
  productEnabled: boolean;
  globalEnabled: boolean;
  effectiveEnabled: boolean;
}>;

export type CodexSkillView = Readonly<{
  ref: string;
  name: string;
  displayName: string;
  description: string;
  root: CodexSkillRoot;
  scope: "user" | "admin";
  deprecated: boolean;
  metadataBytes: number;
  manualInvocationAvailable: boolean;
  state: CodexSkillLayerState;
}>;

export type CodexBackendSkillCapability = Readonly<{
  backend: "codex" | "claude" | "opencode" | "kimi";
  state: "managed" | "available-not-integrated" | "policy-disabled" | "file-only";
}>;

export type CodexSkillsAvailability =
  | Readonly<{ kind: "ready" }>
  | Readonly<{ kind: "read-only"; reason: string }>;

export type CodexSkillsSnapshot = Readonly<{
  revision: number;
  configDigest: `sha256:${string}`;
  availability: CodexSkillsAvailability;
  skills: readonly CodexSkillView[];
  summary: Readonly<{
    manageableCount: number;
    metadataBytes: number;
    estimatedTokens: number;
  }>;
  capabilities: readonly CodexBackendSkillCapability[];
}>;

export type SetProductCodexSkillInput = Readonly<{
  skillRef: string;
  enabled: boolean;
  expectedRevision: number;
}>;

export type PreviewGlobalCodexSkillInput = SetProductCodexSkillInput;

export type GlobalCodexSkillPreview = Readonly<{
  previewId: string;
  skillName: string;
  enabled: boolean;
  expectedRevision: number;
  impact: "all-codex-clients";
}>;

export type GlobalCodexSkillAuthority = Readonly<{
  authorityToken: string;
  expiresAt: number;
}>;

export type ApplyGlobalCodexSkillInput = Readonly<{
  previewId: string;
  authorityToken: string;
  expectedRevision: number;
}>;
