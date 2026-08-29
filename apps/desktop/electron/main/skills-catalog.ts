/**
 * [INPUT]: Depends on canonical workspace/Project context, backend project/system descriptors, authoritative Library/Extension candidates, frozen per-turn tool policy, runtime capability facts, guarded filesystem reads, and renderer IPC
 * [OUTPUT]: Provides scoped EffectiveSkillSnapshot and durable selection receipts, deterministic truncation, targeted invalidation, require-fresh resolution, and workspace-plus-Project keyed refs
 * [POS]: Main Skills read authority; owner, exact Extension generation, and frozen tool policy are selected before catalog, picker, prompt, or use_skill projection
 */

import { basename, dirname } from "node:path";
import type { BrowserWindow } from "electron";
import type {
  AgentBackendId,
  PreparedSkillSelectionReceipt,
  AgentWorkspaceScope,
} from "../../shared/agent-ipc";
import type { TurnProjectContext } from "../../shared/product-resource-scope";
import {
  SKILLS_CHANNEL,
  type SkillInfo,
  type SkillsListInput,
  type SkillsListResult,
  type SkillsScope,
} from "../../shared/skills-ipc";
import { productFailed, productOk } from "../../shared/product-failure";
import {
  allowedToolsFor,
  builtinToolSpec,
  type BuiltinToolName,
} from "../../shared/builtin-tools";
import { rendererIpc } from "./ipc-registrar";
import {
  backendById,
  backendRuntimeRegistry,
  orderedBackends,
} from "./backends";
import { skillRequirementSatisfied } from "./skills-management/skill-requirements";
import {
  composeEffectiveSkillSnapshot,
  preparedSkillCandidates,
  type BackendSkillCapabilityFacts,
  type EffectiveSkillCandidate,
  type EffectiveSkillSnapshot,
  type SkillGenerationRef,
} from "./skills-management/effective-snapshot";
import {
  SKILL_COUNT_LIMIT,
  parseSkillFrontmatter,
  scanSkillsResult,
} from "./skills-catalog-scan";
import {
  catalogSkillOf,
  readStableSkill,
  runtimeError,
  scopeOf,
  toEffectiveCandidate,
  toRuntimeFailure,
} from "./skills-catalog-runtime";

export { readStableSkill } from "./skills-catalog-runtime";

export { SKILL_FRONTMATTER_PATTERN } from "./skills-management/skill-frontmatter";
export { skillRequirementSatisfied } from "./skills-management/skill-requirements";
export {
  parseSkillFrontmatter,
  scanSkillRoots,
  scanSkillRootsResult,
} from "./skills-catalog-scan";

const CATALOG_REVALIDATE_MS = 30 * 60_000;

/* token 的键必须带 workspace：library/extension 的 ref 是跨 workspace 的
   全局身份，单以 ref 建键会让后扫描的 workspace 覆盖先前的授权。 */
const NO_PROJECT_CONTEXT: TurnProjectContext = {
  projectId: null,
  projectLifecycleRevision: null,
};
const projectContextKey = (context: TurnProjectContext) =>
  context.projectId
    ? `project:${context.projectId}:${context.projectLifecycleRevision}`
    : "global";
const workspaceScopeKey = (workspace: string, context: TurnProjectContext) =>
  `${workspace}\0${projectContextKey(context)}`;
const tokenKey = (
  workspace: string,
  context: TurnProjectContext,
  ref: string
) => `${workspaceScopeKey(workspace, context)}\0${ref}`;

/* 身份三元组（sourceKind/generationRef/digest）与 ownerRef 是必填项：从前它们
   可选，缺口由 `??` 兜底补成错误语义——extension 掉成 system、路径哈希冒充
   内容摘要害 use_skill 永远 changed-during-read。分支消灭在编译期。 */
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
type CacheEntry = { snapshot: CatalogSnapshot; expiresAt: number };
type TokenEntry = CatalogSkill & {
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

export class SkillsCatalog {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<CatalogSnapshot>>();
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly invalidatedTokens = new Map<string, TokenEntry>();
  private readonly pendingInvalidationWorkspaces = new Set<string>();
  private readonly invalidatedRefs = new Set<string>();
  private generation = 0;
  private window: BrowserWindow | null = null;
  private productGateResolver: ((skillFilePath: string) => Promise<boolean | null> | boolean | null) | null = null;

  constructor(
    private readonly resolveWorkspace: WorkspaceResolver,
    private readonly dependencies: SkillsCatalogDependencies = {}
  ) {}

  setProductSkillGateResolver(
    resolver: (skillFilePath: string) => Promise<boolean | null> | boolean | null
  ) {
    this.productGateResolver = resolver;
    this.invalidate();
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    rendererIpc(window, rendererUrl, "拒绝非主窗口的 Skills 请求")
      .handle(SKILLS_CHANNEL.list, async (input) => {
        try {
          return productOk(await this.listView(input as SkillsListInput));
        } catch (cause) {
          return productFailed(toRuntimeFailure(cause));
        }
      })
      .handle(SKILLS_CHANNEL.capabilities, async (scope) => {
        try {
          return productOk({ plan: (await this.snapshot(scope as SkillsScope)).plan });
        } catch (cause) {
          return productFailed(toRuntimeFailure(cause));
        }
      });
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  async list(input: SkillsListInput | SkillsScope): Promise<SkillInfo[]> {
    const request =
      "backend" in input
        ? input
        : { scope: input, backend: "codex" as const, planMode: false };
    this.assertAccess(request);
    const projectContext = this.resolveWorkspace(
      this.assertScope(request.scope)
    ).projectContext ?? NO_PROJECT_CONTEXT;
    const effective = await this.effectiveSnapshot(
      request,
      undefined,
      request.forceReload === true
    );
    return effective.entries
      .filter((entry) => entry.channels.includes("picker"))
      .map((entry) => ({
        ref: entry.ownerRef,
        name: entry.slug,
        description: entry.metadata.description,
        scope: scopeOf(entry.sourceKind),
        ownerScope: entry.extensionSelection?.ownerScope ??
          (entry.sourceKind === "project" && projectContext.projectId
            ? { kind: "project" as const, projectId: projectContext.projectId }
            : { kind: "global" as const }),
        ...(entry.extensionSelection
          ? { extensionInstallIdentity: entry.extensionSelection.installIdentity }
          : {}),
        ...(entry.metadata.displayName
          ? { displayName: entry.metadata.displayName }
          : {}),
        ...(entry.requires ? { requires: entry.requires } : {}),
      }));
  }

  async listView(input: SkillsListInput): Promise<SkillsListResult> {
    this.assertAccess(input);
    const effective = await this.effectiveSnapshot(
      input,
      undefined,
      input.forceReload === true
    );
    const skills = await this.list(input);
    const snapshot = await this.snapshot(input.scope);
    const totalCount = effective.entries.length;
    return {
      skills,
      truncated: snapshot.truncated === true,
      matchedCount: totalCount,
      hiddenCount: Math.max(0, totalCount - skills.length),
    };
  }

  async effectiveSnapshot(
    input: Pick<SkillsListInput, "scope" | "backend" | "planMode">,
    capability?: BackendSkillCapabilityFacts,
    forceReload = false
  ): Promise<EffectiveSkillSnapshot> {
    const access = this.assertAccess(input as SkillsListInput);
    const normalized = this.assertScope(input.scope);
    const resolved = this.resolveWorkspace(normalized);
    const workspace = resolved.workspace;
    const projectContext = resolved.projectContext ?? NO_PROJECT_CONTEXT;
    const toolPolicy = await this.dependencies.toolPolicyForScope?.({
      scope: normalized,
      workspace,
      backend: access.backend,
      planMode: access.planMode,
    });
    return this.effectiveSnapshotForWorkspace(
      workspace,
      access.backend,
      access.planMode,
      capability,
      forceReload,
      projectContext,
      toolPolicy
    );
  }

  async effectiveSnapshotForWorkspace(
    workspace: string,
    backend: SkillsListInput["backend"],
    planMode: boolean,
    capability?: BackendSkillCapabilityFacts,
    forceReload = false,
    projectContext: TurnProjectContext = NO_PROJECT_CONTEXT,
    toolPolicy?: FrozenSkillsToolPolicy
  ): Promise<EffectiveSkillSnapshot> {
    const raw = await this.snapshotWorkspace(
      workspace,
      forceReload,
      projectContext
    );
    const allowedTools = toolPolicy
      ? [...toolPolicy.allowedTools]
      : await this.allowedTools(backend, planMode);
    const candidates = await Promise.all(
      raw.skills.map(async (skill) => ({
        ...toEffectiveCandidate(skill),
        enabled:
          skill.enabled !== false &&
          (await this.productGateResolver?.(skill.path)) !== false,
      }))
    );
    return composeEffectiveSkillSnapshot({
      backend,
      planMode,
      allowedTools,
      capability:
        capability ?? (await this.defaultCapability(backend)),
      candidates,
    });
  }

  async prepareSelectionReceipt(input: Readonly<{
    refOwnerId: string;
    workspace: string;
    backend: AgentBackendId;
    planMode: boolean;
    projectContext: TurnProjectContext;
    visibleInventoryVersion: string;
  }>): Promise<PreparedSkillSelectionReceipt> {
    const snapshot = await this.effectiveSnapshotForWorkspace(
      input.workspace,
      input.backend,
      input.planMode,
      {
        backend: input.backend,
        useSkillRegistered: false,
        exactIssued: false,
        autoApproved: false,
        runtimeRootReadable: false,
      },
      false,
      input.projectContext
    );
    return Object.freeze({
      refOwnerId: input.refOwnerId,
      projectContext: structuredClone(input.projectContext),
      visibleInventoryVersion: input.visibleInventoryVersion,
      backend: input.backend,
      planMode: input.planMode,
      candidates: Object.freeze(preparedSkillCandidates(snapshot)),
    });
  }

  async effectiveSnapshotFromPrepared(
    receipt: PreparedSkillSelectionReceipt,
    capability: BackendSkillCapabilityFacts,
    toolPolicy?: FrozenSkillsToolPolicy
  ) {
    const allowedTools = toolPolicy
      ? [...toolPolicy.allowedTools]
      : await this.allowedTools(receipt.backend, receipt.planMode);
    return composeEffectiveSkillSnapshot({
      backend: receipt.backend,
      planMode: receipt.planMode,
      allowedTools,
      capability,
      candidates: receipt.candidates,
    });
  }

  async resolveSkill(
    ref: string,
    workspace: string,
    access: SkillResolutionAccess = {
      backend: "codex",
      planMode: false,
    },
    projectContext: TurnProjectContext = NO_PROJECT_CONTEXT
  ) {
    /* Sending is require-fresh: never use a stale list snapshot to decide that
       a chip is still deliverable. */
    const key = tokenKey(workspace, projectContext, ref);
    const previouslyIssued =
      this.tokens.get(key) ?? this.invalidatedTokens.get(key);
    await this.snapshotWorkspace(workspace, true, projectContext);
    await this.assertProductGate(
      this.tokens.get(key) ?? this.invalidatedTokens.get(key) ?? previouslyIssued
    );
    let token = this.tokens.get(key);
    const now = this.now();
    const runtimeKey = this.identity();
    if (!token || token.runtimeKey !== runtimeKey) {
      const cached = this.cache.get(
        `${runtimeKey}\0${workspaceScopeKey(workspace, projectContext)}`
      );
      const knownRef = cached?.snapshot.skills.some(
        (skill) => skill.ref === ref
      );
      if (!knownRef) {
        this.tokens.delete(key);
        throw runtimeError("ref-invalid", { version: 1, kind: "ref", ref });
      }
      await this.snapshotWorkspace(workspace, false, projectContext);
      token = this.tokens.get(key);
    }
    if (!token || token.runtimeKey !== runtimeKey) {
      this.tokens.delete(key);
      throw runtimeError("ref-invalid", { version: 1, kind: "ref", ref });
    }
    const effective = await this.effectiveSnapshotForWorkspace(
      workspace,
      access.backend,
      access.planMode,
      undefined,
      false,
      projectContext,
      access.toolPolicy
    );
    if (!effective.entries.some((entry) =>
      entry.ownerRef === ref && entry.available
    )) {
      throw runtimeError("ref-invalid", { version: 1, kind: "ref", ref });
    }
    if (token.revalidateAt <= now) {
      await this.snapshotWorkspace(workspace, false, projectContext);
      token = this.tokens.get(key);
      if (!token || token.revalidateAt <= now) {
        throw runtimeError("ref-invalid", { version: 1, kind: "ref", ref });
      }
    }
    const content = await readStableSkill(token.path);
    const fresh = parseSkillFrontmatter(
      content.toString("utf8"),
      basename(dirname(token.path))
    );
    const allowedTools = access.toolPolicy
      ? [...access.toolPolicy.allowedTools]
      : await this.allowedTools(access.backend, access.planMode);
    if (
      fresh.name !== token.name ||
      !skillRequirementSatisfied(fresh.requires, allowedTools)
    ) {
      throw runtimeError("requirement-blocked", fresh.requires
        ? { version: 1, kind: "requirement", requirement: fresh.requires }
        : { version: 1, kind: "none" });
    }
    return {
      type: "skill" as const,
      name: token.name,
      path: token.path,
      content: new Uint8Array(content),
      ...(access.toolPolicy
        ? {
            ...(fresh.requires ? { requires: fresh.requires } : {}),
            requirementReceipt: {
              requirement: fresh.requires ?? null,
              policyDigest: access.toolPolicy.policyDigest,
            },
          }
        : {}),
    };
  }

  async assertPlanAvailable(
    requested: boolean,
    workspace: string,
    backend: AgentBackendId = "codex"
  ) {
    if (!requested) return;
    if (this.dependencies.query) {
      const snapshot = await this.snapshotWorkspace(
        workspace,
        true,
        NO_PROJECT_CONTEXT
      );
      if (!snapshot.plan) throw runtimeError("plan-unsupported");
      return;
    }
    const runtime = await backendRuntimeRegistry.resolve(backend);
    if (
      runtime.runtimeStatus !== "installed" ||
      !runtime.capabilities.planMode
    ) {
      throw runtimeError("plan-unsupported");
    }
    await this.snapshotWorkspace(workspace, false, NO_PROJECT_CONTEXT);
  }

  clear() {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
    this.tokens.clear();
    this.invalidatedTokens.clear();
    this.invalidatedRefs.clear();
    this.pendingInvalidationWorkspaces.clear();
  }

  /** 丢扫描缓存但保留已签发 token；旧 turn 可继续 resolve，新列表强制重扫。 */
  invalidate() {
    const workspaces = new Map(
      [...this.tokens.values()].map((token) => [
        workspaceScopeKey(token.workspace, token.projectContext),
        { workspace: token.workspace, projectContext: token.projectContext },
      ])
    );
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
    for (const [key, target] of workspaces) {
      this.pendingInvalidationWorkspaces.add(key);
      void this.snapshotWorkspace(
        target.workspace,
        false,
        target.projectContext
      ).catch(() => {
        if (this.pendingInvalidationWorkspaces.delete(key)) {
          this.publishInvalidationDiff();
        }
      });
    }
    if (!workspaces.size) this.publishInvalidationDiff();
  }

  /** Project policy changes invalidate only the affected workspace scan/token lane. */
  invalidateWorkspace(workspace: string) {
    if (!workspace) return;
    const targets = new Map(
      [...this.tokens.values()]
        .filter((token) => token.workspace === workspace)
        .map((token) => [
          workspaceScopeKey(token.workspace, token.projectContext),
          { workspace: token.workspace, projectContext: token.projectContext },
        ])
    );
    this.generation += 1;
    for (const key of [...this.cache.keys()]) {
      if (key.includes(`\0${workspace}\0`)) this.cache.delete(key);
    }
    for (const key of [...this.pending.keys()]) {
      if (key.includes(`\0${workspace}\0`)) this.pending.delete(key);
    }
    for (const [key, target] of targets) {
      this.pendingInvalidationWorkspaces.add(key);
      void this.snapshotWorkspace(
        target.workspace,
        false,
        target.projectContext
      ).catch(() => {
        if (this.pendingInvalidationWorkspaces.delete(key)) {
          this.publishInvalidationDiff();
        }
      });
    }
    if (!targets.size) this.publishInvalidationDiff();
  }

  invalidateProject(projectId: string | null) {
    if (projectId === null) {
      this.invalidate();
      return;
    }
    const targets = new Map(
      [...this.tokens.values()]
        .filter((token) => token.projectContext.projectId === projectId)
        .map((token) => [
          workspaceScopeKey(token.workspace, token.projectContext),
          { workspace: token.workspace, projectContext: token.projectContext },
        ])
    );
    this.generation += 1;
    for (const key of [...this.cache.keys()]) {
      if (key.includes(`\0project:${projectId}:`)) this.cache.delete(key);
    }
    for (const key of [...this.pending.keys()]) {
      if (key.includes(`\0project:${projectId}:`)) this.pending.delete(key);
    }
    for (const [key, target] of targets) {
      this.pendingInvalidationWorkspaces.add(key);
      void this.snapshotWorkspace(
        target.workspace,
        false,
        target.projectContext
      ).catch(() => {
        if (this.pendingInvalidationWorkspaces.delete(key)) {
          this.publishInvalidationDiff();
        }
      });
    }
    if (!targets.size) this.publishInvalidationDiff();
  }

  private async snapshot(scope: SkillsScope, forceReload = false) {
    const normalized = this.assertScope(scope);
    const resolved = this.resolveWorkspace(normalized);
    const workspace = resolved.workspace;
    const projectContext = resolved.projectContext ?? NO_PROJECT_CONTEXT;
    return this.snapshotWorkspace(workspace, forceReload, projectContext);
  }

  private async snapshotWorkspace(
    workspace: string,
    forceReload = false,
    projectContext: TurnProjectContext = NO_PROJECT_CONTEXT
  ) {
    const generation = this.generation;
    const runtimeKey = this.identity();
    const scopedWorkspace = workspaceScopeKey(workspace, projectContext);
    const key = `${runtimeKey}\0${scopedWorkspace}`;
    const cached = this.cache.get(key);
    if (!forceReload && cached) {
      cached.snapshot = this.bindStableRefs(
        cached.snapshot,
        workspace,
        runtimeKey,
        cached.expiresAt,
        projectContext
      );
      if (cached.expiresAt <= this.now()) {
        /* Stale-ok list: answer now and refresh in the existing single-flight
           lane. Resolution never uses this path. */
        void this.snapshotWorkspace(workspace, true, projectContext).catch(
          () => undefined
        );
      }
      return cached.snapshot;
    }
    /* Force and ordinary scans have different identities: a force request may
       join another force request, but must never reuse an older ordinary scan. */
    const pendingKey = forceReload ? `${key}\0force` : key;
    let query = this.pending.get(pendingKey);
    const discoverRaw = this.dependencies.query
      ? () => this.dependencies.query!(workspace)
      : async () => {
          const discovered = await scanSkillsResult(
            workspace,
            ((await this.dependencies.managedSkills?.(projectContext)) ?? []).map(
              catalogSkillOf
            )
          );
          return {
            skills: discovered.skills,
            truncated: discovered.truncated,
            totalCount: discovered.totalCount,
            all: discovered.all,
            scanTruncated: discovered.scanTruncated,
            plan: orderedBackends().some((backend) =>
              backend.capabilitiesFor({
                executable: "",
                path: "",
                version: "999.999.999",
              }).planMode
            ),
          };
        };
    const discover = async (): Promise<CatalogSnapshot> => {
      const snapshot = await discoverRaw();
      return snapshot;
    };
    query ??= discover()
      .then((unbound) => {
        /* 输掉 generation 竞争的扫描不许碰 token 表：改写会把仍有效的 ref
           算进 invalidatedRefs、把 chip 误标成失效。它只把结果还给自己的等待者。 */
        const committed = generation === this.generation;
        if (!committed) return unbound;
        const expiresAt = this.now() + CATALOG_REVALIDATE_MS;
        const snapshot = this.bindStableRefs(
          unbound,
          workspace,
          runtimeKey,
          expiresAt,
          projectContext
        );
        const entry = { snapshot, expiresAt };
        this.cache.set(key, entry);
        /* skills:changed 是全局 epoch，缓存动作也必须是全局的。若只刷新当前
           workspace，其他 workspace 响应广播重拉时仍会命中 30 分钟旧快照。 */
        if (forceReload) this.publishRefresh(key, entry);
        else if (this.pendingInvalidationWorkspaces.delete(scopedWorkspace)) {
          this.publishInvalidationDiff();
        }
        return snapshot;
      })
      .finally(() => {
        if (this.pending.get(pendingKey) === query) this.pending.delete(pendingKey);
      });
    this.pending.set(pendingKey, query);
    return query;
  }

  /** 推进全局 epoch，只保留本次扫描已经证明为新的快照。 */
  private publishRefresh(key: string, entry: CacheEntry) {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
    this.cache.set(key, entry);
    this.pendingInvalidationWorkspaces.clear();
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(SKILLS_CHANNEL.changed, {
        generation: this.generation,
        invalidatedRefs: [...this.invalidatedRefs],
      });
    }
    this.invalidatedRefs.clear();
  }

  private publishInvalidationDiff() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(SKILLS_CHANNEL.changed, {
        generation: this.generation,
        invalidatedRefs: [...this.invalidatedRefs],
      });
    }
    this.invalidatedRefs.clear();
  }

  private bindStableRefs(
    snapshot: CatalogSnapshot,
    workspace: string,
    runtimeKey: string,
    revalidateAt: number,
    projectContext: TurnProjectContext
  ): CatalogSnapshot {
    /* ref 就是稳定身份（ownerRef 同值）：按 name+path 给随机 ref 续期的机制
       就此退役——从前对外发 ownerRef、对内按随机 ref 发 token，两个值域在
       resolveSkill 撞在同一个参数位上，项目/system 的 chip 一发送就 ref-invalid。
       token 按 workspace\0ref 建键：library/extension 的 ref 是全局身份，
       两个 workspace 的授权互不覆盖。失效判定保留 name 维度：同一 ref
       改了名，chip 上的旧名字必须被标失效。 */
    const active = new Set(
      snapshot.skills.map((skill) => `${skill.ref}\0${skill.name}`)
    );
    const contextKey = projectContextKey(projectContext);
    for (const [key, token] of this.tokens) {
      if (
        token.workspace === workspace &&
        token.projectContextKey === contextKey &&
        (token.runtimeKey !== runtimeKey ||
          !active.has(`${token.ref}\0${token.name}`))
      ) {
        this.invalidatedRefs.add(token.ref);
        this.rememberInvalidatedToken(key, token);
        this.tokens.delete(key);
      }
    }
    for (const skill of snapshot.skills) {
      const key = tokenKey(workspace, projectContext, skill.ref);
      this.tokens.set(key, {
        ...skill,
        workspace,
        projectContextKey: contextKey,
        projectContext: structuredClone(projectContext),
        runtimeKey,
        revalidateAt,
      });
      this.invalidatedTokens.delete(key);
    }
    return snapshot;
  }

  private now() {
    return (this.dependencies.now ?? Date.now)();
  }

  private async assertProductGate(token: TokenEntry | undefined) {
    if (
      token &&
      this.productGateResolver &&
      await this.productGateResolver(token.path) === false
    ) {
      throw runtimeError("requirement-blocked", {
        version: 1,
        kind: "requirement",
        requirement: "product-gate",
      });
    }
  }

  private rememberInvalidatedToken(key: string, token: TokenEntry) {
    this.invalidatedTokens.set(key, token);
    while (this.invalidatedTokens.size > SKILL_COUNT_LIMIT * 2) {
      const oldest = this.invalidatedTokens.keys().next().value;
      if (oldest === undefined) break;
      this.invalidatedTokens.delete(oldest);
    }
  }

  private identity() {
    return this.dependencies.identity?.() ?? "filesystem";
  }

  private assertScope(value: SkillsScope): SkillsScope {
    if (!value || typeof value !== "object") throw runtimeError("invalid-request");
    const keys = Object.keys(value);
    if (value.kind === "default" && keys.length === 1) return value;
    const id =
      value.kind === "conversation"
        ? value.conversationId
        : value.kind === "project"
          ? value.projectId
          : value.kind === "app"
            ? value.appId
            : undefined;
    if (keys.length !== 2 || !id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw runtimeError("invalid-request");
    }
    return value;
  }

  private assertAccess(input: SkillsListInput) {
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.planMode !== "boolean" ||
      (input.forceReload !== undefined && typeof input.forceReload !== "boolean")
    ) {
      throw runtimeError("invalid-request");
    }
    try {
      const backend = backendById(input.backend).id;
      return { backend, planMode: input.planMode };
    } catch {
      throw runtimeError("invalid-request");
    }
  }

  private async allowedTools(
    backend: SkillsListInput["backend"],
    planMode: boolean
  ) {
    const projected = await this.dependencies.allowedTools?.(backend, planMode);
    if (projected) return [...projected];
    const descriptor = backendById(backend);
    const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
    const effective =
      snapshot.runtimeStatus === "installed"
        ? snapshot.capabilities.builtinTools
        : "none";
    const access = effective === "none" ? "none" : planMode ? "read" : effective;
    const disabled = new Set(this.dependencies.disabledTools?.() ?? []);
    return allowedToolsFor(access, "manual", planMode).filter((name) => {
      if (disabled.has(name)) return false;
      const allowlist = builtinToolSpec(name)?.backendAllowlist;
      return !allowlist || allowlist.includes(backend);
    });
  }

  private async defaultCapability(
    backend: SkillsListInput["backend"]
  ): Promise<BackendSkillCapabilityFacts> {
    const snapshot = await backendRuntimeRegistry.resolve(backend);
    const builtin =
      snapshot.runtimeStatus === "installed" &&
      snapshot.capabilities.builtinTools !== "none";
    return {
      backend,
      useSkillRegistered: Boolean(builtinToolSpec("use_skill")),
      exactIssued: builtin,
      autoApproved: builtin,
      runtimeRootReadable: builtin,
    };
  }
}
