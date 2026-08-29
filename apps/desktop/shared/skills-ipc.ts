/**
 * [INPUT]: Depends on shared Agent workspace/backend identity, Product resource owner scope, and ProductResult envelopes
 * [OUTPUT]: Provides pathless Skills catalog results with explicit owner scope, truncation counts, Plan capability, invalidated-ref events, and preload bridge contracts
 * [POS]: Shared runtime Skills wire truth; listing may be stale, sending revalidates in main, and failures cross IPC as structured data
 */

import type { AgentBackendId, AgentWorkspaceScope } from "./agent-ipc";
import type { ProductResult } from "./product-failure";
import type { ProductResourceScope } from "./product-resource-scope";

export type SkillsScope = AgentWorkspaceScope;

export type SkillInfo = {
  ref: string;
  name: string;
  description: string;
  scope: "user" | "repo" | "system" | "admin" | "extension";
  /** Authoritative resource owner; renderer grouping must never infer this from source kind. */
  ownerScope: ProductResourceScope;
  /** Exact package owner for Extension Skills; absent for filesystem/library Skills. */
  extensionInstallIdentity?: string;
  displayName?: string;
  requires?: string;
};

export type SkillsListInput = {
  scope: SkillsScope;
  backend: AgentBackendId;
  planMode: boolean;
  forceReload?: boolean;
};

export type SkillsListResult = Readonly<{
  skills: readonly SkillInfo[];
  truncated: boolean;
  matchedCount: number;
  hiddenCount: number;
}>;

export const SKILLS_CHANNEL = {
  list: "skills:list",
  capabilities: "skills:capabilities",
  changed: "skills:changed",
} as const;

export type SkillsChangedEvent = Readonly<{
  generation: number;
  invalidatedRefs: readonly string[];
}>;

export type SkillsBridgeApi = {
  list(input: SkillsListInput): Promise<ProductResult<SkillsListResult>>;
  capabilities(scope: SkillsScope): Promise<ProductResult<{ plan: boolean }>>;
  onChanged(callback: (event: SkillsChangedEvent) => void): () => void;
};
