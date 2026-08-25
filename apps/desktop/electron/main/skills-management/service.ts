/**
 * [INPUT]: Depends on Library/Projection stores, goal/package mechanism, Extension registry read only inventory, Codex Skills service and select narrow ports with the native folder
 * [OUTPUT]: Provides UnifiedSkillsService: Background rediscovery/read-only degradation, library merger, path security authority, quad-dimensional digest, drift and explicit recovery, projection takeover, Codex session file, and preview phase of identified cross-source names (name-taken, including intra-batch first-seen-owns-the-name) and unabridged numbers/bytes; per-source held previews keep only the latest one
 * [POS]: Unified Skills Management business; HOME scans do not enter the boot key path, and the external bytes only enter the renderer state after verifying the fact
 */

import { createHash, randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import type {
  ManagedSkillAction,
  ManagedSkillActionPreview,
  ManagedSkillAgent,
  ManagedSkillCandidate,
  ManagedSkillCandidateError,
  ManagedSkillImportPreview,
  ManagedSkillLibraryItem,
  ManagedSkillReason,
  ManagedSkillTargetView,
  UnifiedSkillsSnapshot,
} from "../../../shared/unified-skills-ipc";
import type { CodexSkillsService } from "../backends/codex/skills-service";
import { extensionPackageRoot } from "../extensions/skill-candidates";
import type { ExtensionRegistryStore } from "../extensions/registry-store";
import {
  ManagedSkillsLibraryStore,
  type ImportLibraryCandidate,
  type ManagedSkillsLibraryEntry,
} from "./library-store";
import {
  inspectPackageFolder,
  inspectSkillFolder,
  observeSkillFolderDigest,
  scanAgentSkillsRoot,
  type SkillFolderDigestObservation,
  type SkillFolderInspection,
} from "./package";
import {
  ManagedSkillProjectionStore,
  type ProjectionAuthorityFields,
} from "./projection-store";
import {
  resolveManagedSkillTargets,
  resolveManagedSkillUserHome,
  resolveSharedSkillsRoot,
  targetForAgent,
  type ManagedSkillTarget,
} from "./targets";

type CandidateAuthority = Readonly<{
  ref: string;
  agent: ManagedSkillAgent | "local-folder";
  sourcePath: string;
  sourceRoot: string;
  sourceIdentity: string;
  inspection: SkillFolderInspection;
}>;

type LibrarySource = Readonly<{
  libraryId: string;
  ref: string;
  name: string;
  displayName: string;
  description: string;
  digest: `sha256:${string}`;
  sourcePath: string;
  source: Readonly<{ kind: "github" | "local-folder" | "adopted"; label: string; generation: number }>;
  local: ManagedSkillsLibraryEntry | null;
}>;

type HeldImport = ManagedSkillImportPreview & {
  authorities: ReadonlyMap<string, CandidateAuthority>;
  /* 这份预览成立时，哪些候选的 name 已被别的来源占着 */
  taken: ReadonlySet<string>;
};
type HeldAction = Readonly<{
  view: ManagedSkillActionPreview;
  fields: ProjectionAuthorityFields;
  source: LibrarySource;
  targetPath: string;
  mode: "projection" | "takeover";
}>;

const agentSchema = z.enum(["codex", "claude", "kimi", "opencode"]);
const refSchema = z.string().min(1).max(512);
const revisionSchema = z.number().int().nonnegative();
const importInputSchema = z.object({
  previewId: refSchema,
  revision: z.string().min(1).max(512),
  candidateRefs: z.array(refSchema).min(1).max(512),
}).strict();
const previewActionInputSchema = z.object({
  skillRef: refSchema,
  agent: agentSchema,
  action: z.enum(["project", "takeover", "remove", "recover"]),
  expectedRevision: revisionSchema,
}).strict();
const applyActionInputSchema = z.object({
  previewId: refSchema,
  authorityToken: refSchema,
  expectedRevision: revisionSchema,
}).strict();
const setProductInputSchema = z.object({
  skillRef: refSchema,
  enabled: z.boolean(),
  expectedRevision: revisionSchema,
}).strict();

export type UnifiedSkillsServiceDependencies = Readonly<{
  userData: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  registry: ExtensionRegistryStore;
  codex: CodexSkillsService;
  chooseLocalFolder(): Promise<string | null>;
  library?: ManagedSkillsLibraryStore;
  projections?: ManagedSkillProjectionStore;
  scanSkillsRoot?: typeof scanAgentSkillsRoot;
  observeSkillDigest?: typeof observeSkillFolderDigest;
}>;

export class UnifiedSkillsService {
  readonly library: ManagedSkillsLibraryStore;
  readonly projections: ManagedSkillProjectionStore;
  private readonly targets: readonly ManagedSkillTarget[];
  private readonly userHome: string;
  private readonly imports = new Map<string, HeldImport>();
  private readonly actions = new Map<string, HeldAction>();
  private readonly watchers = new Set<(snapshot: UnifiedSkillsSnapshot) => void>();
  private revision = 0;
  private lastCandidates = emptyCandidateState();
  private availability: UnifiedSkillsSnapshot["availability"] = { kind: "ready" };
  private refreshEpoch = 0;
  private discoveryTask: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: UnifiedSkillsServiceDependencies) {
    this.library = dependencies.library ?? new ManagedSkillsLibraryStore(dependencies.userData);
    this.projections = dependencies.projections ?? new ManagedSkillProjectionStore(dependencies.userData);
    this.userHome = resolveManagedSkillUserHome(dependencies.userHome, dependencies.env);
    this.targets = resolveManagedSkillTargets(this.userHome, dependencies.env);
  }

  async initialize() {
    try {
      await this.library.initialize();
      await this.projections.initialize();
    } catch (cause) {
      this.availability = { kind: "read-only", reason: safeReason(cause) };
      return;
    }
    queueMicrotask(() => this.startBackgroundDiscovery());
  }

  onChanged(listener: (snapshot: UnifiedSkillsSnapshot) => void) {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  list(forceReload = false) {
    return this.serialize(async () => {
      if (forceReload) await this.refreshCandidates();
      return this.projectSnapshot();
    });
  }

  candidates(agent: ManagedSkillAgent, forceReload = false) {
    return this.serialize(async () => {
      agent = agentSchema.parse(agent);
      return publicImportPreview(this.holdPreview(await this.createCandidatePreview(agent, forceReload)));
    });
  }

  chooseLocal() {
    return this.serialize(async () => {
      const root = await this.dependencies.chooseLocalFolder();
      if (!root) return null;
      const inspections = await inspectPackageFolder(root);
      return publicImportPreview(this.holdPreview(this.holdImport("local-folder", root, inspections)));
    });
  }

  /* 同一来源只留最新的一份预览：旧预览已不被任何屏幕展示，留着它既是
     无界增长，也是一条允许「拿着过期事实提交」的暗门。 */
  private holdPreview(held: HeldImport) {
    for (const [id, prior] of this.imports) {
      if (prior.source === held.source) this.imports.delete(id);
    }
    this.imports.set(held.previewId, held);
    return held;
  }

  import(raw: Readonly<{ previewId: string; revision: string; candidateRefs: readonly string[] }>) {
    return this.serialize(async () => {
      this.assertWritable();
      const input = importInputSchema.parse(raw);
      const held = this.imports.get(input.previewId);
      if (!held || held.revision !== input.revision) throw conflict("导入预览已失效，请重新打开");
      const selected = [...new Set(input.candidateRefs)].map((ref) => held.authorities.get(ref));
      if (!selected.length || selected.some((item) => !item)) throw new Error("导入选择包含未知候选");
      const candidates: ImportLibraryCandidate[] = selected.map((authority) => {
        if (!authority!.inspection.importable) throw conflict(`skill-inspection:${authority!.inspection.reason.code}`);
        /* 同名与「读不出来」是同一档结局：都在按钮按下之前就已经不可导入。
           留这道门是因为预览可能比库旧一拍，而 409 一旦穿到 renderer
           就只剩一句「请重试」，而重试永远不会成功。 */
        if (held.taken.has(authority!.ref)) throw conflict("skill-inspection:name-taken");
        return {
          skill: authority!.inspection.skill,
          source: authority!.agent === "local-folder"
            ? { kind: "local-folder", sourcePath: authority!.sourcePath }
            : { kind: "adopted", agent: authority!.agent, sourcePath: authority!.sourcePath },
        };
      });
      await this.library.importCandidates(candidates);
      this.imports.delete(input.previewId);
      this.revision += 1;
      await this.refreshCandidates();
      return this.publish();
    });
  }

  previewAction(raw: Readonly<{
    skillRef: string;
    agent: ManagedSkillAgent;
    action: ManagedSkillAction;
    expectedRevision: number;
  }>) {
    return this.serialize(async () => {
      const input = previewActionInputSchema.parse(raw);
      this.assertRevision(input.expectedRevision);
      const source = (await this.librarySources()).find((item) => item.ref === input.skillRef);
      if (!source) throw conflict("Skill 库条目已变化，请刷新");
      const target = targetForAgent(this.targets, input.agent);
      const binding = this.projections.activeBinding(source.libraryId, input.agent);
      const tracked = this.projections.trackedBinding(source.libraryId, input.agent);
      let targetPath = join(target.path, source.name);
      let mode: "projection" | "takeover" = "projection";
      let operationDigest = source.digest;
      if (input.action === "remove") {
        if (!binding) throw conflict("该 Skill 没有可移除的受管投影");
        targetPath = binding.targetPath;
        mode = binding.mode;
        operationDigest = binding.digest as `sha256:${string}`;
      } else if (input.action === "recover") {
        if (!tracked || tracked.state !== "foreign") throw conflict("该 Skill 没有待恢复的漂移 binding");
        targetPath = tracked.targetPath;
        mode = tracked.mode;
        operationDigest = tracked.digest as `sha256:${string}`;
        if (mode === "takeover") {
          const observed = await this.observeTarget(targetPath);
          if (observed.kind === "unavailable") throw conflict("恢复目标暂时无法校验，请稍后重试");
          if (observed.kind !== "missing" && !digestMatches(observed, operationDigest)) {
            throw conflict("请先移走外部修改的 Skill，再恢复原件");
          }
        }
      } else if (input.action === "takeover") {
        if (tracked?.state === "foreign") throw conflict("该 Skill 有待恢复的漂移 binding");
        const origin = source.local?.origin;
        if (!origin || origin.agent !== input.agent || origin.state !== "imported-source") {
          throw conflict("接管必须来自该 Agent 已单独导入、尚未接管的原件");
        }
        if (origin.digest !== source.digest) throw conflict("原件 digest 与库主本不一致");
        const canonicalTarget = await realpath(targetPath).catch(() => targetPath);
        if (origin.sourcePath !== canonicalTarget) {
          throw conflict("共享或自定义发现根只读展示，不能作为品牌目标接管");
        }
        targetPath = origin.sourcePath;
        mode = "takeover";
      } else if (tracked?.state === "foreign") {
        throw conflict("该 Skill 有待恢复的漂移 binding");
      }
      const previewId = randomUUID();
      const component = `skill:${source.libraryId}`;
      const fields: ProjectionAuthorityFields = {
        previewId,
        agent: input.agent,
        component,
        target: targetPath,
        digest: operationDigest,
        action: input.action,
      };
      const view: ManagedSkillActionPreview = {
        previewId,
        expectedRevision: this.revision,
        action: input.action,
        agent: input.agent,
        skillRef: input.skillRef,
        skillName: source.displayName,
        component,
        target: `${target.id}/${source.name}`,
        digest: operationDigest,
        visibleTo: target.visibleTo,
        warning: input.agent === "claude"
          ? "claude-product-surface"
          : target.visibleTo.length > 1 ? "coupled-target" : "global-filesystem",
      };
      const held = { view, fields, source, targetPath, mode };
      this.actions.set(previewId, held);
      return view;
    });
  }

  authorizeAction(previewId: string) {
    return this.serialize(async () => {
      this.assertWritable();
      previewId = refSchema.parse(previewId);
      const held = this.actions.get(previewId);
      if (!held) throw conflict("Skill 操作预览已失效，请重新确认");
      this.assertRevision(held.view.expectedRevision);
      return this.projections.authorize(held.fields);
    });
  }

  applyAction(raw: Readonly<{ previewId: string; authorityToken: string; expectedRevision: number }>) {
    return this.serialize(async () => {
      this.assertWritable();
      const input = applyActionInputSchema.parse(raw);
      const held = this.actions.get(input.previewId);
      if (!held || held.view.expectedRevision !== input.expectedRevision) {
        throw conflict("Skill authority 与当前状态不匹配");
      }
      this.assertRevision(input.expectedRevision);
      this.actions.delete(input.previewId);
      const operation = await this.projections.execute({
        ...held.fields,
        authorityToken: input.authorityToken,
        idempotencyKey: input.previewId,
        libraryId: held.source.libraryId,
        sourcePath: held.source.sourcePath,
        mode: held.mode,
      });
      if (held.source.local?.origin) {
        if (held.view.action === "takeover" && operation.bindingId) {
          await this.library.markOriginManaged(held.source.libraryId, operation.bindingId);
        } else if (["remove", "recover"].includes(held.view.action)
          && held.mode === "takeover"
          && !this.projections.trackedBinding(held.source.libraryId, held.view.agent)) {
          await this.library.markOriginRestored(held.source.libraryId);
        }
      }
      this.revision += 1;
      await this.refreshCandidates();
      return this.publish();
    });
  }

  setProduct(raw: Readonly<{ skillRef: string; enabled: boolean; expectedRevision: number }>) {
    return this.serialize(async () => {
      this.assertWritable();
      const input = setProductInputSchema.parse(raw);
      this.assertRevision(input.expectedRevision);
      const source = (await this.librarySources()).find((item) => item.ref === input.skillRef);
      if (!source) throw conflict("Skill 库条目已变化，请刷新");
      const native = await this.dependencies.codex.list(true);
      const skill = native.skills.find((item) => item.name === source.name && item.root === "codex");
      if (!skill) throw new Error("Codex 原生清单尚未发现该投影");
      await this.dependencies.codex.setProduct({
        skillRef: skill.ref,
        enabled: input.enabled,
        expectedRevision: native.revision,
      });
      this.revision += 1;
      return this.publish();
    });
  }

  dismissOnboarding() {
    return this.serialize(async () => {
      this.assertWritable();
      await this.library.dismissOnboarding();
      this.revision += 1;
      return this.publish();
    });
  }

  async shutdown() {
    await this.discoveryTask?.catch(() => undefined);
    await this.library.closeAndFlush();
    await this.projections.closeAndFlush();
  }

  private serialize<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private startBackgroundDiscovery() {
    if (this.discoveryTask) return;
    this.discoveryTask = this.serialize(async () => {
      const committed = await this.refreshCandidates();
      if (committed) await this.publish();
    })
      .catch(() => undefined)
      .finally(() => { this.discoveryTask = null; });
  }

  private async refreshCandidates() {
    const epoch = ++this.refreshEpoch;
    const byAgent = new Map<ManagedSkillAgent, CandidateAuthority[]>();
    const errors: ManagedSkillCandidateError[] = [];
    const scanner = this.dependencies.scanSkillsRoot ?? scanAgentSkillsRoot;
    const scans = new Map<string, Promise<Readonly<{ inspections: readonly SkillFolderInspection[]; error: ManagedSkillReason | null }>>>();
    const scan = (root: string) => {
      const pending = scans.get(root);
      if (pending) return pending;
      const created = scanner(root).then(
        (inspections) => ({ inspections, error: null }),
        (cause) => ({ inspections: [], error: safeReason(cause) })
      );
      scans.set(root, created);
      return created;
    };
    for (const target of this.targets) {
      if (target.agent === "codex") continue;
      for (const root of discoveryRoots(target, this.userHome)) void scan(root);
    }
    for (const target of this.targets) {
      if (target.agent === "codex") {
        const candidates: CandidateAuthority[] = [];
        try {
          const native = await this.dependencies.codex.candidateSource(true);
          const seen = new Set<string>();
          for (const skill of native.skills) {
            if (skill.scope !== "user") continue;
            const sourcePath = dirname(skill.path);
            if (seen.has(sourcePath)) continue;
            seen.add(sourcePath);
            const inspection = await inspectSkillFolder(sourcePath);
            const authority = {
              ref: randomUUID(),
              agent: "codex" as const,
              sourcePath,
              sourceRoot: dirname(sourcePath),
              sourceIdentity: privateIdentity(sourcePath),
              inspection,
            } satisfies CandidateAuthority;
            candidates.push(authority);
            if (!inspection.importable) {
              errors.push({ agent: "codex", label: inspection.name, reason: inspection.reason });
            }
          }
          for (const reason of native.errors) {
            errors.push({ agent: "codex", label: "Codex discovery", reason: safeReason(reason) });
          }
        } catch (cause) {
          errors.push({ agent: "codex", label: "Codex discovery", reason: safeReason(cause) });
        }
        byAgent.set("codex", candidates);
        continue;
      }
      const candidates: CandidateAuthority[] = [];
      for (const root of discoveryRoots(target, this.userHome)) {
        const result = await scan(root);
        if (result.error) errors.push({ agent: target.agent, label: "Skills discovery", reason: result.error });
        for (const inspection of result.inspections) {
          const ref = randomUUID();
          const sourcePath = inspection.importable ? inspection.skill.canonicalPath : join(root, inspection.name);
          const authority = {
            ref,
            agent: target.agent,
            sourcePath,
            sourceRoot: root,
            sourceIdentity: privateIdentity(sourcePath),
            inspection,
          } satisfies CandidateAuthority;
          candidates.push(authority);
          if (!inspection.importable) {
            errors.push({ agent: target.agent, label: inspection.name, reason: inspection.reason });
          }
        }
      }
      byAgent.set(target.agent, candidates);
    }
    const bindings = this.projections.snapshot().bindings.filter((item) => item.state === "active");
    /* 「未纳管」= 收得进来、不是本产品自己投影出去的、而且名字没被别的来源占着。
       三条缺一，屏幕上那个数就会跟「全部导入」真正会导的那批对不上——
       而对不上的数字比没有数字更坏。 */
    const owners = new Map(this.library.snapshot().entries.map((entry) => [entry.name, entry.provenance.sourceIdentity]));
    const unmanaged = (agent: ManagedSkillAgent) => (byAgent.get(agent) ?? []).filter((candidate) => {
      if (!candidate.inspection.importable) return false;
      if (bindings.some((binding) => binding.agent === agent && binding.targetPath === candidate.sourcePath)) return false;
      const owner = owners.get(candidate.inspection.skill.name);
      return !owner || owner === candidate.sourceIdentity;
    });
    const unmanagedByAgent = Object.fromEntries(
      this.targets.map((target) => [target.agent, unmanaged(target.agent).length])
    ) as Record<ManagedSkillAgent, number>;
    const unmanagedBytes = this.targets.reduce(
      (sum, target) => sum + unmanaged(target.agent).reduce(
        (bytes, candidate) => bytes + (candidate.inspection.importable ? candidate.inspection.skill.bytes : 0),
        0
      ),
      0
    );
    const revision = privateIdentity(JSON.stringify([...byAgent].flatMap(([agent, items]) =>
      items.map((item) => [
        agent,
        item.sourceIdentity,
        item.inspection.importable
          ? item.inspection.skill.revision
          : item.inspection.revision,
      ])
    )));
    if (epoch !== this.refreshEpoch) return false;
    this.lastCandidates = { revision, byAgent, unmanagedByAgent, unmanagedBytes, errors: dedupeErrors(errors) };
    return true;
  }

  private async createCandidatePreview(agent: ManagedSkillAgent, forceReload: boolean) {
    /* 页签之间来回切不该每次重扫四家 HOME——那是上万次 lstat 的活，
       而屏幕上那几个数字本就来自这份缓存，重扫只会让每次切换卡一下。
       「从未扫过」是唯一必须先扫的情形，这个判断归 main：只有它知道
       自己扫没扫过，renderer 不该替它猜。 */
    if (forceReload || !this.lastCandidates.revision) await this.refreshCandidates();
    const authorities = new Map((this.lastCandidates.byAgent.get(agent) ?? []).map((item) => [item.ref, item]));
    return this.holdImport(agent, "", [...authorities.values()].map((item) => item.inspection), authorities);
  }

  private holdImport(
    source: ManagedSkillAgent | "local-folder",
    root: string,
    inspections: readonly SkillFolderInspection[],
    supplied?: ReadonlyMap<string, CandidateAuthority>
  ): HeldImport {
    const authorities = supplied ?? new Map(inspections.map((inspection) => {
      const ref = randomUUID();
      const path = inspection.importable ? inspection.skill.canonicalPath : root;
      return [ref, { ref, agent: source, sourcePath: path, sourceRoot: root, sourceIdentity: privateIdentity(path), inspection } satisfies CandidateAuthority];
    }));
    const taken = this.nameTakenRefs(authorities);
    const candidates = [...authorities.values()].map((item) => candidateView(item, taken.has(item.ref)));
    const revision = privateIdentity(JSON.stringify(candidates.map((item) => [item.ref, item.revision, item.digest])));
    return { previewId: randomUUID(), revision, source, candidates, authorities, taken };
  }

  /* ── 同名不是错误，是候选身上的一个理由 ──────────────────────────
   * library-store 的 assertNamesDoNotConflict 说了：库里一个 name 只对应
   * 一个来源身份。而跨四家同名是常态——Codex 的 animations 与 Claude 的
   * animations 是两个来源，第二批整批 409。
   *
   * 409 穿到 renderer 只会翻成一句「操作失败，请重试」，而重试永远不会
   * 成功——那是一条走不出去的路。把判断提到预览这一刻，它们在按钮按下
   * 之前就已经是「收不进来」，落进既有的折叠组，409 于是没有机会发生。
   * ──────────────────────────────────────────────────────────── */
  private nameTakenRefs(authorities: ReadonlyMap<string, CandidateAuthority>) {
    const owners = new Map(this.library.snapshot().entries.map((entry) => [entry.name, entry.provenance.sourceIdentity]));
    const taken = new Set<string>();
    for (const authority of authorities.values()) {
      if (!authority.inspection.importable) continue;
      const owner = owners.get(authority.inspection.skill.name);
      /* 同一个来源再导一次是「新一代」，不是冲突。 */
      if (owner && owner !== authority.sourceIdentity) {
        taken.add(authority.ref);
        continue;
      }
      /* 批内先见者占名：同一份预览里的第二个同名不同源，写入时必撞。
         库内与批内走同一条判定——它们本来就是同一个问题。 */
      owners.set(authority.inspection.skill.name, authority.sourceIdentity);
    }
    return taken;
  }

  private async projectSnapshot(): Promise<UnifiedSkillsSnapshot> {
    const library = await Promise.all((await this.librarySources()).map((item) => this.projectLibraryItem(item)));
    const totalUnmanaged = Object.values(this.lastCandidates.unmanagedByAgent).reduce((sum, value) => sum + value, 0);
    const stored = this.library.snapshot();
    return {
      revision: this.revision,
      availability: this.availability,
      library,
      candidates: {
        revision: this.lastCandidates.revision,
        unmanagedByAgent: this.lastCandidates.unmanagedByAgent,
        unmanagedBytes: this.lastCandidates.unmanagedBytes,
        errors: this.lastCandidates.errors,
      },
      onboarding: {
        visible: !stored.onboardingDismissed && totalUnmanaged > 0,
        totalUnmanaged,
        codexUnmanaged: this.lastCandidates.unmanagedByAgent.codex,
      },
    };
  }

  private async projectLibraryItem(source: LibrarySource): Promise<ManagedSkillLibraryItem> {
    return {
      ref: source.ref,
      name: source.name,
      displayName: source.displayName,
      description: source.description,
      digest: source.digest,
      source: source.source,
      targets: await Promise.all(this.targets.map((target) => this.projectTarget(source, target))),
    };
  }

  private async projectTarget(source: LibrarySource, target: ManagedSkillTarget): Promise<ManagedSkillTargetView> {
    const nominalTarget = join(target.path, source.name);
    const binding = this.projections.trackedBinding(source.libraryId, target.agent);
    const targetPath = binding?.targetPath ?? nominalTarget;
    const observed = binding ? await this.observeTarget(targetPath) : null;
    const present = observed
      ? observed.kind === "unavailable" ? await exists(targetPath) : observed.kind !== "missing"
      : await exists(targetPath);
    const canonicalTarget = present
      ? await realpath(targetPath).catch(() => targetPath)
      : targetPath;
    let drifted = binding?.state === "foreign";
    let bindingState = binding?.state;
    let managed = false;
    if (binding?.state === "active") {
      /* unavailable 不是漂移证据：保留 ledger 所有权，下一次快照继续复核。 */
      managed = observed?.kind === "unavailable" || Boolean(observed && digestMatches(observed, binding.digest));
      if (!managed && observed?.kind !== "unavailable") {
        drifted = await this.projections.markForeign(binding.bindingId);
        if (drifted) {
          bindingState = "foreign";
          this.revision += 1;
        }
      }
    }
    const origin = source.local?.origin;
    const ownership = managed
      ? "managed-projection"
      : origin?.state === "imported-source" && origin.agent === target.agent && origin.sourcePath === canonicalTarget
        ? "imported-source"
        : present || drifted ? "foreign" : "absent";
    const recovery = binding && bindingState === "foreign"
      ? binding.mode === "projection"
        ? "ready"
        : observed?.kind === "missing" || Boolean(observed && digestMatches(observed, binding.digest))
          ? "ready"
          : observed?.kind === "unavailable" ? "none" : "move-foreign-target"
      : "none";
    let nativeEnabled: boolean | "unknown" = present ? "unknown" : false;
    let productEnabled: boolean | "not-applicable" | "unknown" = "not-applicable";
    let sessionVisible: boolean | "unknown" = false;
    if (target.agent === "codex") {
      const snapshot = await this.dependencies.codex.list(false).catch(() => null);
      const nativeName = basename(targetPath);
      const native = snapshot?.skills.find((item) => item.name === nativeName && item.root === "codex");
      nativeEnabled = native?.state.globalEnabled ?? (present ? "unknown" : false);
      productEnabled = native?.state.productEnabled ?? (present ? "unknown" : false);
      sessionVisible = present && nativeEnabled === true && productEnabled === true;
    } else if (target.agent === "opencode") {
      sessionVisible = false;
    } else {
      sessionVisible = present ? "unknown" : false;
    }
    return {
      agent: target.agent,
      targetId: target.id,
      label: target.label,
      deprecated: target.deprecated,
      visibleTo: target.visibleTo,
      state: { present, nativeEnabled, productEnabled, sessionVisible, ownership, recovery },
    };
  }

  private observeTarget(path: string) {
    return (this.dependencies.observeSkillDigest ?? observeSkillFolderDigest)(path);
  }

  private async librarySources(): Promise<LibrarySource[]> {
    const local = this.library.snapshot().entries.map((entry) => {
      const generation = entry.generations.find((item) => item.generationId === entry.activeGenerationId)!;
      return {
        libraryId: entry.libraryId,
        ref: `local:${entry.libraryId}`,
        name: entry.name,
        displayName: entry.displayName,
        description: entry.description,
        digest: generation.digest as `sha256:${string}`,
        sourcePath: this.library.packagePath(entry),
        source: {
          kind: entry.provenance.kind,
          label: entry.provenance.kind === "adopted" ? `${entry.provenance.agent} import` : "Local folder",
          generation: entry.generations.length,
        },
        local: entry,
      } satisfies LibrarySource;
    });
    const inventory = this.dependencies.registry.snapshot();
    const github: LibrarySource[] = [];
    for (const owner of inventory.packages) {
      if (owner.administrativeState !== "active" || !owner.activeGenerationRef) continue;
      const generation = owner.generations.find((item) => item.packageGenerationId === owner.activeGenerationRef!.packageGenerationId);
      if (!generation) continue;
      const root = extensionPackageRoot(this.dependencies.userData, generation.contentDigest);
      /* 自家装进来的包：digest 是投影授权凭据，必须当场算出，不吃发现预算。 */
      const inspections = await scanAgentSkillsRoot(join(root, "skills"), { hashAll: true });
      const skillsByName = new Map(
        inspections
          .filter((item) => item.importable)
          .map((item) => [item.skill.name, item] as const),
      );
      for (const component of inventory.components) {
        if (component.kind !== "skill" || component.packageGenerationRef.packageGenerationId !== generation.packageGenerationId) continue;
        const name = component.componentId.replace(/^skill:/, "");
        const exact = skillsByName.get(name);
        if (!exact?.importable) continue;
        github.push({
          libraryId: `extension:${component.componentIdentity}`,
          ref: `extension:${component.componentIdentity}`,
          name: exact.skill.name,
          displayName: exact.skill.displayName,
          description: exact.skill.description,
          digest: exact.skill.digest!,
          sourcePath: exact.skill.canonicalPath,
          source: { kind: "github", label: owner.source.normalizedUrl, generation: owner.generations.length },
          local: null,
        });
      }
    }
    return [...local, ...github].sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private assertRevision(expected: number) {
    if (expected !== this.revision) throw conflict("Skills 状态已变化，请刷新后重试");
  }

  private assertWritable() {
    if (this.availability.kind === "read-only") {
      throw Object.assign(new Error("Skill 管理当前为只读"), { status: 503 });
    }
  }

  private async publish() {
    const snapshot = await this.projectSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
    return snapshot;
  }
}

function candidateView(authority: CandidateAuthority, nameTaken = false): ManagedSkillCandidate {
  const inspection = authority.inspection;
  return inspection.importable && !nameTaken
    ? {
        ref: authority.ref,
        agent: authority.agent,
        name: inspection.skill.name,
        displayName: inspection.skill.displayName,
        description: inspection.skill.description,
        digest: inspection.skill.digest,
        revision: inspection.skill.revision,
        files: inspection.skill.files.length,
        bytes: inspection.skill.bytes,
        importable: true,
        reason: null,
        preview: inspection.skill.preview,
      }
    : {
        ref: authority.ref,
        agent: authority.agent,
        name: inspection.importable ? inspection.skill.name : inspection.name,
        displayName: inspection.importable ? inspection.skill.displayName : inspection.name,
        /* 理由不冒充描述：它有自己的位置，也有自己的语言。 */
        description: "",
        digest: null,
        revision: inspection.importable ? inspection.skill.revision : inspection.revision,
        files: 0,
        bytes: 0,
        importable: false,
        reason: inspection.importable ? { code: "name-taken" } : inspection.reason,
        preview: "",
      };
}

function publicImportPreview(held: HeldImport): ManagedSkillImportPreview {
  return { previewId: held.previewId, revision: held.revision, source: held.source, candidates: held.candidates };
}

function emptyCandidateState() {
  return {
    revision: "",
    byAgent: new Map<ManagedSkillAgent, CandidateAuthority[]>(),
    unmanagedByAgent: { codex: 0, claude: 0, kimi: 0, opencode: 0 } as Record<ManagedSkillAgent, number>,
    unmanagedBytes: 0,
    errors: [] as ManagedSkillCandidateError[],
  };
}

function privateIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function digestMatches(observed: SkillFolderDigestObservation, digest: string) {
  return observed.kind === "present" && observed.digest === digest;
}

function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function safeReason(cause: unknown): ManagedSkillReason {
  const code = (cause as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") return { code: "unreadable" };
  if (code === "ENOENT") return { code: "missing" };
  if (code === "ETIMEDOUT") return { code: "timeout" };
  return { code: "unknown" };
}

/* ── 同一个文件夹只报一次 ──────────────────────────────────────────
 * `~/.agents/skills` 被 kimi 与 opencode 各扫一遍，codex 又从原生清单里
 * 看见同一个目录——于是一个读不动的文件夹在界面上排成三条红字，读者以为
 * 自己有三个问题。同一 (名字, 理由, 细节) 就是同一件事，报一次即可。
 * ────────────────────────────────────────────────────────────── */
function dedupeErrors(errors: readonly ManagedSkillCandidateError[]) {
  const seen = new Set<string>();
  return errors.filter((item) => {
    const key = `${item.label}\u0000${item.reason.code}\u0000${item.reason.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function discoveryRoots(target: ManagedSkillTarget, userHome: string) {
  return target.agent === "claude"
    ? [target.path]
    : [target.path, resolveSharedSkillsRoot(userHome)];
}

async function exists(path: string) {
  return access(path).then(() => true, () => false);
}
