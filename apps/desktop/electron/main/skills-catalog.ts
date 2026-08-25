/**
 * [INPUT]: Depends on descriptor skills Extension, runtime registry, final builtin allowedTools, shared skills Contract, O_NOFOLLOW IPC read and rendered simultaneously
 * [OUTPUT]: Provides SkillsCatalog, scan/parse/readStableSkill, manual listedPaths and unified skillRequirementSatisfied; directory only service `$` Panel and opaque ref
 * [POS]: Electron main's manual Skill/Plan capability to discover the boundaries; Active lists when running are independently held by agent/SkillInventoryIndex
 */

import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { BrowserWindow } from "electron";
import type {
  AgentBackendId,
  AgentWorkspaceScope,
} from "../../shared/agent-ipc";
import {
  SKILLS_CHANNEL,
  type SkillInfo,
  type SkillsListInput,
  type SkillsScope,
} from "../../shared/skills-ipc";
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

const CATALOG_REVALIDATE_MS = 30 * 60_000;

export type CatalogSkill = SkillInfo & { path: string };
export type CatalogSnapshot = { skills: CatalogSkill[]; plan: boolean };
type CacheEntry = { snapshot: CatalogSnapshot; expiresAt: number };
type TokenEntry = CatalogSkill & {
  workspace: string;
  runtimeKey: string;
  revalidateAt: number;
};

export type SkillsCatalogDependencies = {
  query?: (workspace: string) => Promise<CatalogSnapshot>;
  now?: () => number;
  identity?: () => string;
  /** 受管扩展的已启用 skill 候选；由组合根注入，catalog 不认识 Registry */
  extensionSkills?: () => Promise<CatalogSkill[]>;
  /** Settings 的 live 停用集；catalog 与 turn 使用同一份工具关闭语义。 */
  disabledTools?: () => readonly string[];
  /** 测试/窄调用可直接注入最终 allowedTools，绕开 runtime 探测。 */
  allowedTools?: (
    backend: SkillsListInput["backend"],
    planMode: boolean
  ) => readonly BuiltinToolName[] | Promise<readonly BuiltinToolName[]>;
};

const skillIdentity = (skill: Pick<CatalogSkill, "name" | "path">) =>
  `${skill.name}\0${skill.path}`;

export type WorkspaceResolver = (
  scope: AgentWorkspaceScope
) => { workspace: string };

const SKILL_FILE_LIMIT = 128 * 1024;
const SKILL_COUNT_LIMIT = 256;
const SKILL_DEPTH_LIMIT = 2;

/** frontmatter 块的唯一识别式；catalog 解析与 App 包自检共用，两处判定不得各写一份。 */
export const SKILL_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/;

export function parseSkillFrontmatter(
  content: string,
  fallbackName: string
) {
  const block = SKILL_FRONTMATTER_PATTERN.exec(content)?.[1] ?? "";
  const fields = new Map<string, string>();
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    fields.set(match[1]!, match[2]!.replace(/^['"]|['"]$/g, ""));
  }
  const name = fields.get("name")?.trim() || fallbackName;
  const description = fields.get("description")?.trim() || `Skill: ${name}`;
  const displayName = fields.get("displayName")?.trim();
  const rawRequires = fields.get("requires")?.trim();
  const requires: SkillInfo["requires"] = rawRequires || undefined;
  return {
    name,
    description,
    ...(displayName ? { displayName } : {}),
    ...(requires ? { requires } : {}),
  };
}

async function scanSkillRoot(
  root: string,
  scope: CatalogSkill["scope"],
  output: Map<string, CatalogSkill>
) {
  let canonicalRoot: string;
  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
    canonicalRoot = await realpath(root);
  } catch {
    return;
  }
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > SKILL_DEPTH_LIMIT || output.size >= SKILL_COUNT_LIMIT) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (output.size >= SKILL_COUNT_LIMIT) return;
      const path = resolve(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) continue;
      const canonical = await realpath(path);
      const location = relative(canonicalRoot, canonical);
      if (location.startsWith("..") || isAbsolute(location)) continue;
      if (metadata.isDirectory()) {
        await visit(path, depth + 1);
        continue;
      }
      if (
        entry.name !== "SKILL.md" ||
        !metadata.isFile() ||
        metadata.size > SKILL_FILE_LIMIT
      ) {
        continue;
      }
      const content = await readFile(path, "utf8");
      const detail = parseSkillFrontmatter(content, basename(dirname(path)));
      output.set(canonical, {
        ref: randomUUID(),
        path: canonical,
        scope,
        ...detail,
      });
    }
  };
  await visit(canonicalRoot, 0);
}

export async function scanSkillRoots(
  roots: Array<{ root: string; scope: CatalogSkill["scope"] }>,
  /* 受管扩展的候选不来自某个可扫描的根：包内只有被逐项启用的那几个 skill 算数，
     整根扫描会把「安装」误当成「启用」。所以它们作为已解析条目直接并入去重。 */
  extra: readonly CatalogSkill[] = []
) {
  const output = new Map<string, CatalogSkill>();
  for (const { root, scope } of roots) {
    await scanSkillRoot(root, scope, output);
  }
  for (const skill of extra) {
    if (output.size >= SKILL_COUNT_LIMIT) break;
    output.set(skill.path, skill);
  }
  const priority: Record<CatalogSkill["scope"], number> = {
    user: 4,
    admin: 4,
    extension: 3,
    repo: 2,
    system: 1,
  };
  const byName = new Map<string, CatalogSkill>();
  for (const skill of output.values()) {
    const current = byName.get(skill.name);
    if (!current || priority[skill.scope] > priority[current.scope]) {
      byName.set(skill.name, skill);
    }
  }
  return [...byName.values()];
}

export async function scanSkills(
  workspace: string,
  extra: readonly CatalogSkill[] = []
) {
  const sources = new Map<string, CatalogSkill["scope"]>();
  for (const backend of orderedBackends()) {
    const declared =
      backend.skills?.sources(workspace) ?? [];
    for (const source of declared) {
      const key = resolve(source.path);
      const current = sources.get(key);
      if (!current || source.scope === "user") sources.set(key, source.scope);
    }
  }
  return scanSkillRoots(
    [...sources].map(([root, scope]) => ({ root, scope })),
    extra
  );
}

export class SkillsCatalog {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<CatalogSnapshot>>();
  private readonly tokens = new Map<string, TokenEntry>();
  private generation = 0;
  private window: BrowserWindow | null = null;

  constructor(
    private readonly resolveWorkspace: WorkspaceResolver,
    private readonly dependencies: SkillsCatalogDependencies = {}
  ) {}

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    rendererIpc(window, rendererUrl, "拒绝非主窗口的 Skills 请求")
      .handle(SKILLS_CHANNEL.list, (input) =>
        this.list(input as SkillsListInput)
      )
      .handle(SKILLS_CHANNEL.capabilities, async (scope) => ({
        plan: (await this.snapshot(scope as SkillsScope)).plan,
      }));
    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  async list(input: SkillsListInput | SkillsScope): Promise<SkillInfo[]> {
    const request =
      "backend" in input
        ? input
        : { scope: input, backend: "codex" as const, planMode: false };
    const access = this.assertAccess(request);
    const snapshot = await this.snapshot(request.scope);
    const allowedTools = await this.allowedTools(access.backend, access.planMode);
    return snapshot.skills
      .filter((skill) => skillRequirementSatisfied(skill.requires, allowedTools))
      .map(({ path: _path, ...skill }) => skill);
  }

  /** 只给 main 内部做「原生 Skill 是否真实出现在 `$` catalog」交集；不签发 path 给 renderer。 */
  async listedPaths(scope: SkillsScope): Promise<ReadonlySet<string>> {
    const snapshot = await this.snapshot(scope);
    return new Set(snapshot.skills.map((skill) => skill.path));
  }

  async resolveSkill(
    ref: string,
    workspace: string,
    access: Pick<SkillsListInput, "backend" | "planMode"> = {
      backend: "codex",
      planMode: false,
    }
  ) {
    let token = this.tokens.get(ref);
    const now = this.now();
    const runtimeKey = this.identity();
    if (!token || token.runtimeKey !== runtimeKey) {
      const cached = this.cache.get(`${runtimeKey}\0${workspace}`);
      const knownRef = cached?.snapshot.skills.some(
        (skill) => skill.ref === ref
      );
      if (!knownRef) {
        this.tokens.delete(ref);
        throw new Error("Skill 引用已失效或不存在");
      }
      await this.snapshotWorkspace(workspace);
      token = this.tokens.get(ref);
    }
    if (!token || token.runtimeKey !== runtimeKey) {
      this.tokens.delete(ref);
      throw new Error("Skill 引用已失效或不存在");
    }
    if (token.workspace !== workspace) {
      throw new Error("Skill 引用不属于当前 workspace");
    }
    if (token.revalidateAt <= now) {
      await this.snapshotWorkspace(workspace);
      token = this.tokens.get(ref);
      if (!token || token.revalidateAt <= now) {
        throw new Error("Skill 已停用或引用无法续期");
      }
    }
    const content = await readStableSkill(token.path);
    const fresh = parseSkillFrontmatter(
      content.toString("utf8"),
      basename(dirname(token.path))
    );
    const allowedTools = await this.allowedTools(
      access.backend,
      access.planMode
    );
    if (
      fresh.name !== token.name ||
      !skillRequirementSatisfied(fresh.requires, allowedTools)
    ) {
      throw new Error("当前 Agent/Plan 模式不允许使用这个 Skill，请移除 chip");
    }
    return {
      type: "skill" as const,
      name: token.name,
      path: token.path,
      content: new Uint8Array(content),
    };
  }

  async assertPlanAvailable(
    requested: boolean,
    workspace: string,
    backend: AgentBackendId = "codex"
  ) {
    if (!requested) return;
    if (this.dependencies.query) {
      const snapshot = await this.snapshotWorkspace(workspace);
      if (!snapshot.plan) throw new Error("当前后端不支持 Plan");
      return;
    }
    const descriptor = backendById(backend);
    const runtime = await backendRuntimeRegistry.resolve(backend);
    if (
      runtime.runtimeStatus !== "installed" ||
      !runtime.capabilities.planMode
    ) {
      throw new Error(`${descriptor.displayName} 不支持 Plan`);
    }
    await this.snapshotWorkspace(workspace);
  }

  clear() {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
    this.tokens.clear();
  }

  /** 丢扫描缓存但保留已签发 token；旧 turn 可继续 resolve，新列表强制重扫。 */
  invalidate() {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(SKILLS_CHANNEL.changed, {
        generation: this.generation,
      });
    }
  }

  private async snapshot(scope: SkillsScope) {
    const normalized = this.assertScope(scope);
    const { workspace } = this.resolveWorkspace(normalized);
    return this.snapshotWorkspace(workspace);
  }

  private async snapshotWorkspace(workspace: string) {
    const generation = this.generation;
    const runtimeKey = this.identity();
    const key = `${runtimeKey}\0${workspace}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      cached.snapshot = this.bindStableRefs(
        cached.snapshot,
        workspace,
        runtimeKey,
        cached.expiresAt
      );
      return cached.snapshot;
    }
    let query = this.pending.get(key);
    const discover = this.dependencies.query
      ? () => this.dependencies.query!(workspace)
      : async () => ({
          skills: await scanSkills(
            workspace,
            (await this.dependencies.extensionSkills?.()) ?? []
          ),
          plan: orderedBackends().some((backend) =>
            backend.capabilitiesFor({
              executable: "",
              path: "",
              version: "999.999.999",
            }).planMode
          ),
        });
    query ??= discover()
      .then((unbound) => {
        const expiresAt = this.now() + CATALOG_REVALIDATE_MS;
        const snapshot = this.bindStableRefs(
          unbound,
          workspace,
          runtimeKey,
          expiresAt
        );
        if (generation === this.generation) {
          this.cache.set(key, { snapshot, expiresAt });
        }
        return snapshot;
      })
      .finally(() => {
        if (this.pending.get(key) === query) this.pending.delete(key);
      });
    this.pending.set(key, query);
    return query;
  }

  private bindStableRefs(
    snapshot: CatalogSnapshot,
    workspace: string,
    runtimeKey: string,
    revalidateAt: number
  ): CatalogSnapshot {
    const existingByIdentity = new Map(
      [...this.tokens.values()]
        .filter(
          (token) =>
            token.workspace === workspace && token.runtimeKey === runtimeKey
        )
        .map((token) => [skillIdentity(token), token] as const)
    );
    const activeSkills = new Set(snapshot.skills.map(skillIdentity));
    for (const [ref, token] of this.tokens) {
      if (
        token.workspace === workspace &&
        (token.runtimeKey !== runtimeKey ||
          !activeSkills.has(skillIdentity(token)))
      ) {
        this.tokens.delete(ref);
      }
    }
    const skills = snapshot.skills.map((skill) => {
      const ref = existingByIdentity.get(skillIdentity(skill))?.ref ?? skill.ref;
      const bound = { ...skill, ref };
      this.tokens.set(ref, {
        ...bound,
        workspace,
        runtimeKey,
        revalidateAt,
      });
      return bound;
    });
    return { ...snapshot, skills };
  }

  private now() {
    return (this.dependencies.now ?? Date.now)();
  }

  private identity() {
    return this.dependencies.identity?.() ?? "filesystem";
  }

  private assertScope(value: SkillsScope): SkillsScope {
    if (!value || typeof value !== "object") throw new Error("Skills scope 无效");
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
      throw new Error("Skills scope 无效");
    }
    return value;
  }

  private assertAccess(input: SkillsListInput) {
    if (
      !input ||
      typeof input !== "object" ||
      typeof input.planMode !== "boolean"
    ) {
      throw new Error("Skills capability 参数无效");
    }
    const backend = backendById(input.backend).id;
    return { backend, planMode: input.planMode };
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
}

/**
 * Skill requirement 的唯一判定器。legacy 与新语法都只看最终签发集：
 * `tools: domain:access` 要求该领域存在 access 精确相同的工具，写工具不能替代读工具；
 * 精确名则要求全部在场。
 */
export function skillRequirementSatisfied(
  requirement: SkillInfo["requires"],
  allowedTools: readonly string[]
) {
  if (!requirement) return true;
  const allowed = new Set(allowedTools);
  const specs = allowedTools.flatMap((name) => {
    const spec = builtinToolSpec(name);
    return spec ? [spec] : [];
  });
  if (requirement === "builtin-tools: read") return specs.length > 0;
  if (requirement === "builtin-tools: mutate") {
    return specs.some((spec) => spec.access === "mutate");
  }
  const domain = /^tools:\s+([a-z][a-z0-9-]*):(read|mutate)$/.exec(
    requirement
  );
  if (domain) {
    const [, domainId, access] = domain;
    return specs.some(
      (spec) => spec.domainId === domainId && spec.access === access
    );
  }
  const exact = /^tools:\s+([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)$/.exec(
    requirement
  );
  if (exact) {
    const names = exact[1]!.split(",").map((name) => name.trim());
    return names.every(
      (name) => builtinToolSpec(name) !== undefined && allowed.has(name)
    );
  }
  return false;
}

/** 读期间复核 dev/ino/size/mtime；catalog 与受管扩展的逐轮物化共用同一把尺子。 */
export async function readStableSkill(path: string) {
  if ((await realpath(path)) !== path) throw new Error("Skill 路径已被替换");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > SKILL_FILE_LIMIT) {
      throw new Error("Skill 文件无效或体积超限");
    }
    const content = await file.readFile();
    const after = await file.stat();
    if (
      content.byteLength !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error("Skill 在读取期间发生变化");
    }
    return content;
  } finally {
    await file.close();
  }
}
