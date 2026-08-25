/**
 * [INPUT]: Depends on shared Codex Skills DTO, native app-server API, in-product rules store, codex runtime resolver, manual catalog path Projection with Node path/crypto
 * [OUTPUT]: Provides CodexSkillsService: global scope List synthesis, main-only user candidate + errors, opaque ref, layered status, revision CAS, changed, pushed, product inscription and one-time authority
 * [POS]: The Codex original status adaptation layer behind the main page of Unified Skills; The original enabled to stay in two layers with the product rules, and the renderer never sees the path
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  ApplyGlobalCodexSkillInput,
  CodexBackendSkillCapability,
  CodexSkillRoot,
  CodexSkillsSnapshot,
  GlobalCodexSkillAuthority,
  GlobalCodexSkillPreview,
  PreviewGlobalCodexSkillInput,
  SetProductCodexSkillInput,
} from "../../../../shared/codex-skills-ipc";
import type { ResolvedRuntime } from "../types";
import { codexHome } from "../sandbox/fences";
import type { CodexSkillsAppServer, NativeCodexSkill } from "./skills-app-server";
import type { CodexSkillConfigRule, CodexSkillsRuleStore } from "./skills-rule-store";

const AUTHORITY_TTL_MS = 5 * 60_000;
const CAPABILITIES: readonly CodexBackendSkillCapability[] = [
  { backend: "codex", state: "managed" },
  { backend: "claude", state: "available-not-integrated" },
  { backend: "opencode", state: "policy-disabled" },
  { backend: "kimi", state: "file-only" },
];

type RuntimeResult =
  | { kind: "installed"; runtime: ResolvedRuntime }
  | { kind: "unavailable"; reason: string };

type PreviewRecord = GlobalCodexSkillPreview & { path: string; expiresAt: number };
type AuthorityRecord = PreviewRecord & { token: string };

export type CodexSkillsServiceDependencies = Readonly<{
  store: CodexSkillsRuleStore;
  native: CodexSkillsAppServer;
  cwd: string;
  resolveRuntime(): Promise<RuntimeResult>;
  catalogPaths(): Promise<ReadonlySet<string>>;
  now?: () => number;
}>;

export class CodexSkillsService {
  private revision = 0;
  private nativeSkills: readonly NativeCodexSkill[] = [];
  private availability: CodexSkillsSnapshot["availability"] = { kind: "read-only", reason: "Codex Skills API 尚未连接" };
  private fingerprint = "";
  private readonly pathByRef = new Map<string, string>();
  private readonly refByPath = new Map<string, string>();
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly authorities = new Map<string, AuthorityRecord>();
  private readonly watchers = new Set<(snapshot: CodexSkillsSnapshot) => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: CodexSkillsServiceDependencies) {
    dependencies.native.onChanged(() => {
      void this.serialize(async () => {
        this.revision += 1;
        this.expireAuthorities();
        const snapshot = await this.refresh(true, false);
        this.publish(snapshot);
      });
    });
  }

  async initialize() {
    await this.dependencies.store.initialize();
  }

  onChanged(listener: (snapshot: CodexSkillsSnapshot) => void) {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  list(forceReload = false) {
    return this.serialize(() => this.refresh(forceReload));
  }

  /**
   * 统一 Skills 只把原生 list 当候选源：路径与原始 errors 留在 main，且在
   * authority 入口先过滤 admin/system。落盘前还会由统一模块复核 canonical
   * path/revision/digest，故这里不冒充收编 authority。
   */
  candidateSource(forceReload = false) {
    return this.serialize(async () => {
      const runtime = await this.requireRuntime();
      const detailed = await this.dependencies.native.listDetailed(
        runtime,
        this.dependencies.cwd,
        forceReload
      );
      return {
        skills: detailed.skills.filter((skill) => skill.scope === "user"),
        errors: detailed.errors.map((error) => this.safeReason(error)),
      };
    });
  }

  setProduct(raw: SetProductCodexSkillInput) {
    return this.serialize(async () => {
      this.assertWritable();
      const input = this.parseMutation(raw);
      this.assertRevision(input.expectedRevision);
      const path = this.requirePath(input.skillRef);
      await this.dependencies.store.setEnabled(path, input.enabled);
      this.revision += 1;
      this.expireAuthorities();
      const snapshot = await this.refresh(false);
      this.publish(snapshot);
      return snapshot;
    });
  }

  previewGlobal(raw: PreviewGlobalCodexSkillInput): Promise<GlobalCodexSkillPreview> {
    return this.serialize(async () => {
      this.assertWritable();
      const input = this.parseMutation(raw);
      this.assertRevision(input.expectedRevision);
      const path = this.requirePath(input.skillRef);
      const skill = this.projected().skills.find((entry) => entry.ref === input.skillRef);
      if (!skill) throw new Error("Codex Skill 已变化，请刷新后重试");
      const preview: PreviewRecord = {
        previewId: randomUUID(),
        skillName: skill.displayName,
        enabled: input.enabled,
        expectedRevision: input.expectedRevision,
        impact: "all-codex-clients",
        path,
        expiresAt: this.now() + AUTHORITY_TTL_MS,
      };
      this.previews.set(preview.previewId, preview);
      const { path: _path, expiresAt: _expiresAt, ...view } = preview;
      return view;
    });
  }

  authorizeGlobal(previewId: string): Promise<GlobalCodexSkillAuthority> {
    return this.serialize(async () => {
      this.assertWritable();
      if (typeof previewId !== "string") throw new Error("全局 Skill preview 无效");
      this.expireAuthorities();
      const preview = this.previews.get(previewId);
      if (!preview) throw new Error("全局 Skill preview 已过期，请重试");
      this.assertRevision(preview.expectedRevision);
      const token = randomUUID();
      this.authorities.set(token, { ...preview, token });
      this.previews.delete(previewId);
      return { authorityToken: token, expiresAt: preview.expiresAt };
    });
  }

  applyGlobal(raw: ApplyGlobalCodexSkillInput) {
    return this.serialize(async () => {
      this.assertWritable();
      if (!raw || typeof raw !== "object") throw new Error("全局 Skill mutation 无效");
      if (typeof raw.previewId !== "string" || typeof raw.authorityToken !== "string") {
        throw new Error("全局 Skill authority 无效");
      }
      this.assertExpectedRevision(raw.expectedRevision);
      this.expireAuthorities();
      const authority = this.authorities.get(raw.authorityToken);
      if (!authority || authority.previewId !== raw.previewId) {
        throw new Error("全局 Skill authority 已失效，请重新确认");
      }
      if (authority.expectedRevision !== raw.expectedRevision) {
        throw new Error("全局 Skill authority 与签发状态不匹配，请重新确认");
      }
      this.assertRevision(authority.expectedRevision);
      /* authority 授权的是一次尝试，不是一次成功。先消费再触碰 runtime/API，
         原生写失败也必须重新 preview；否则同一能力可被无限重放。 */
      this.authorities.delete(raw.authorityToken);
      const runtime = await this.requireRuntime();
      const result = await this.dependencies.native.write(runtime, authority.path, authority.enabled);
      if (result.effectiveEnabled !== authority.enabled) {
        throw new Error("Codex 未接受 Skill 全局状态变更");
      }
      this.revision += 1;
      const snapshot = await this.refresh(true, false);
      this.publish(snapshot);
      return snapshot;
    });
  }

  freezeRules(): readonly CodexSkillConfigRule[] {
    return this.dependencies.store.rules().map((rule) => ({ ...rule }));
  }

  async shutdown() {
    await this.dependencies.native.close();
    await this.dependencies.store.closeAndFlush();
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async refresh(forceReload: boolean, detectNativeChange = true) {
    try {
      const runtime = await this.requireRuntime();
      const skills = await this.dependencies.native.list(runtime, this.dependencies.cwd, forceReload);
      const next = skills.filter((skill) => skill.scope === "user" || skill.scope === "admin");
      const fingerprint = JSON.stringify(next.map((skill) => [skill.path, skill.name, skill.description, skill.scope, skill.enabled]));
      if (
        detectNativeChange &&
        this.fingerprint &&
        fingerprint !== this.fingerprint
      ) {
        this.revision += 1;
        this.expireAuthorities();
      }
      this.fingerprint = fingerprint;
      this.nativeSkills = next;
      this.availability = { kind: "ready" };
    } catch (cause) {
      this.availability = { kind: "read-only", reason: this.safeReason(cause) };
    }
    return this.projected(await this.dependencies.catalogPaths().catch(() => new Set<string>()));
  }

  private projected(catalogPaths: ReadonlySet<string> = new Set()) : CodexSkillsSnapshot {
    const skills = this.nativeSkills.map((skill) => {
      const ref = this.refFor(skill.path);
      const productEnabled = this.dependencies.store.isEnabled(skill.path);
      const metadataBytes = Buffer.byteLength(`${skill.name}\n${skill.description}`, "utf8");
      return {
        ref,
        name: skill.name,
        displayName: skill.interface?.displayName?.trim() || skill.name,
        description: skill.description,
        root: this.rootOf(skill.path),
        scope: skill.scope as "user" | "admin",
        deprecated: skill.path.split(sep).some((part) => part.toLowerCase().includes("deprecated")),
        metadataBytes,
        manualInvocationAvailable: catalogPaths.has(skill.path),
        state: {
          productEnabled,
          globalEnabled: skill.enabled,
          effectiveEnabled: productEnabled && skill.enabled,
        },
      } as const;
    }).sort((left, right) => left.root.localeCompare(right.root) || left.displayName.localeCompare(right.displayName));
    const metadataBytes = skills.reduce((total, skill) => total + skill.metadataBytes, 0);
    return {
      revision: this.revision,
      configDigest: this.dependencies.store.digest(),
      availability: this.availability,
      skills,
      summary: {
        manageableCount: skills.length,
        metadataBytes,
        estimatedTokens: Math.ceil(metadataBytes / 4),
      },
      capabilities: CAPABILITIES,
    };
  }

  private refFor(path: string) {
    let ref = this.refByPath.get(path);
    if (!ref) {
      ref = randomUUID();
      this.refByPath.set(path, ref);
      this.pathByRef.set(ref, path);
    }
    return ref;
  }

  private requirePath(ref: string) {
    const path = this.pathByRef.get(ref);
    if (!path || !this.nativeSkills.some((skill) => skill.path === path)) {
      throw new Error("Codex Skill 引用已失效，请刷新后重试");
    }
    return path;
  }

  private rootOf(path: string): CodexSkillRoot {
    const runtimeHome = codexHome(process.env);
    if (this.within(path, join(runtimeHome, "skills"))) return "codex";
    if (this.within(path, join(homedir(), ".agents", "skills"))) return "agents";
    if (this.within(path, "/etc/codex/skills")) return "admin";
    return "other";
  }

  private within(path: string, root: string) {
    if (!isAbsolute(path) || !isAbsolute(root)) return false;
    const location = relative(root, path);
    return location === "" || (!location.startsWith("..") && !isAbsolute(location));
  }

  private parseMutation(raw: SetProductCodexSkillInput) {
    if (!raw || typeof raw !== "object" || typeof raw.skillRef !== "string" || typeof raw.enabled !== "boolean") {
      throw new Error("Codex Skill mutation 无效");
    }
    this.assertExpectedRevision(raw.expectedRevision);
    return raw;
  }

  private assertExpectedRevision(value: number) {
    if (!Number.isInteger(value) || value < 0) throw new Error("Codex Skill revision 无效");
  }

  private assertRevision(expected: number) {
    if (expected !== this.revision) throw new Error("Codex Skill 状态已变化，请刷新后重试");
  }

  private assertWritable() {
    if (this.availability.kind !== "ready") {
      throw new Error("Codex Skills 当前为只读状态，请恢复连接后重试");
    }
  }

  private async requireRuntime() {
    const result = await this.dependencies.resolveRuntime();
    if (result.kind !== "installed") throw new Error(result.reason);
    return result.runtime;
  }

  private expireAuthorities() {
    const now = this.now();
    for (const [id, preview] of this.previews) if (preview.expiresAt <= now) this.previews.delete(id);
    for (const [token, authority] of this.authorities) if (authority.expiresAt <= now) this.authorities.delete(token);
  }

  private now() { return this.dependencies.now?.() ?? Date.now(); }

  private safeReason(cause: unknown) {
    const message = cause instanceof Error ? cause.message : serializableReason(cause);
    return message
      .replace(/(?:[\w-]*(?:token|secret|password)[\w-]*)=\S+/gi, "[redacted]")
      .replace(/\/(?:Users|private|home)\/[^\s:]+/g, "[local path]")
      .slice(0, 300);
  }

  private publish(snapshot: CodexSkillsSnapshot) {
    for (const watcher of this.watchers) watcher(snapshot);
  }
}

function serializableReason(cause: unknown) {
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) || "Codex Skills API 不可用";
  } catch {
    return "Codex Skills API 不可用";
  }
}
