/**
 * [INPUT]: Skill references, workspace scope and runtime availability contracts.
 * [OUTPUT]: CatalogSkill, CatalogSnapshot, CacheEntry, TokenEntry, SkillsCatalogDependencies, FrozenSkillsToolPolicy, SkillResolutionAccess, WorkspaceResolver.
 * [POS]: Skill catalog shapes; tokens and invalidation remain owned by the catalog.
 */
import type { AgentWorkspaceScope } from "../../../../shared/ipc/agent/agent-ipc";
import type { TurnProjectContext } from "../../../../shared/product/product-resource-scope";
import { type SkillInfo, type SkillsListInput, type SkillsScope } from "../../../../shared/ipc/agent/skills-ipc";
import { type BuiltinToolName } from "../../../../shared/builtin-tools";
import { type EffectiveSkillCandidate, type SkillGenerationRef } from "../../skills-management/custody/effective-snapshot";

export type CatalogSkill = Omit<SkillInfo, "ownerScope"> & {
  path: string;
  sourceKind: EffectiveSkillCandidate["sourceKind"];
  generationRef: SkillGenerationRef;
  digest: `sha256:${string}`;
  ownerRef: string;
  enabled?: boolean;
  ownerScope?: SkillInfo["ownerScope"];
  extensionSelection?: EffectiveSkillCandidate["extensionSelection"];
};

export type CatalogSnapshot = {
  skills: CatalogSkill[];
  plan: boolean;
  truncated?: boolean;
  totalCount?: number;
  /** 完整去重清单与扫描越界事实：gate 过滤要在 256 之前发生。 */
  all?: CatalogSkill[];
  scanTruncated?: boolean;
};

export type CacheEntry = { snapshot: CatalogSnapshot; expiresAt: number };

export type TokenEntry = CatalogSkill & {
  workspace: string;
  projectContextKey: string;
  projectContext: TurnProjectContext;
  runtimeKey: string;
  revalidateAt: number;
};

export type SkillsCatalogDependencies = {
  query?: (workspace: string) => Promise<CatalogSnapshot>;
  now?: () => number;
  identity?: () => string;
  /** Library/Extension candidates are injected before filesystem roots and reserve the discovery budget. */
  managedSkills?: (
    projectContext: TurnProjectContext
  ) => Promise<EffectiveSkillCandidate[]>;
  /** Settings 的 live 停用集；catalog 与 turn 使用同一份工具关闭语义。 */
  disabledTools?: () => readonly string[];
  /** 测试/窄调用可直接注入最终 allowedTools，绕开 runtime 探测。 */
  allowedTools?: (
    backend: SkillsListInput["backend"],
    planMode: boolean
  ) => readonly BuiltinToolName[] | Promise<readonly BuiltinToolName[]>;
  /** Renderer ambient projection resolves the same Project preference as preparation. */
  toolPolicyForScope?: (input: Readonly<{
    scope: SkillsScope;
    workspace: string;
    backend: SkillsListInput["backend"];
    planMode: boolean;
  }>) => FrozenSkillsToolPolicy | Promise<FrozenSkillsToolPolicy>;
};

export type FrozenSkillsToolPolicy = Readonly<{
  /** Main-authoritative per-turn projection. No live Settings read is allowed. */
  allowedTools: readonly BuiltinToolName[];
  /** Project/resource digest used to fence callers and diagnostics. */
  policyDigest: string;
}>;

export type SkillResolutionAccess = Pick<
  SkillsListInput,
  "backend" | "planMode"
> & Readonly<{
  toolPolicy?: FrozenSkillsToolPolicy;
}>;

export type WorkspaceResolver = (
  scope: AgentWorkspaceScope
) => { workspace: string; projectContext?: TurnProjectContext };
