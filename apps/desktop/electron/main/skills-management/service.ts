/**
 * [INPUT]: Depends on library-v3/jobs-v2 ledgers, Extension Registry gates, runtime discovery facts, read-only Agent-home candidate scanning, package verification, and catalog invalidation
 * [OUTPUT]: Provides UnifiedSkillsService for list/discovery/import, enabled toggles, tombstone deletion, deletion-only consent, enablement-only undo, catalog candidates, progress, and restart recovery
 * [POS]: Library-first Skills coordination boundary; it cannot express or perform projection, native-target, Codex config, or Agent-home writes
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  ManagedSkillAgent,
  ManagedSkillCandidateError,
  ManagedSkillJobProgress,
  ManagedSkillIntentInput,
  ManagedSkillPlanPreview,
  UnifiedSkillsSnapshot,
} from "../../../shared/unified-skills-ipc";
import type { BackendRuntimeRegistry } from "../backends/runtime-registry";
import type { ExtensionRegistryStore } from "../extensions/registry-store";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import {
  buildOwnerFacts,
  candidateView,
  classifyCandidates,
  dedupeErrors,
  safeReason,
  type CandidateAuthority,
} from "./candidate-status";
import type { EffectiveSkillCandidate } from "./effective-snapshot";
import { SkillsJobLedger, type SkillsJobStep } from "./jobs/ledger";
import {
  estimateLibraryPromptBytes,
  planExistingIntent,
  planImportIntent,
  reportFor,
} from "./job-planning";
import {
  ManagedSkillsLibraryStore,
  type LibraryCustodyProbe,
} from "./library-store";
import {
  inspectPackageFolder,
  inspectSkillFolder,
  scanAgentSkillsRoot,
  verifyInspectedSkill,
  type SkillFolderInspection,
} from "./package";
import {
  resolveManagedSkillTargets,
  resolveManagedSkillUserHome,
  type ManagedSkillTarget,
} from "./targets";
import {
  AGENTS,
  candidateAuthority,
  digestJson,
  discoveryRoots,
  emptyCandidateState,
  emptyCounts,
  privateIdentity,
  publicPreview,
  sourceViews,
  type CandidateState,
  type HeldImport,
} from "./orchestration/discovery-state";
import { resolveLibrarySources } from "./orchestration/library-sources";
import { buildExtensionCapabilitySnapshot } from "../extensions/capability-snapshot";
import {
  backendExtensionProbe,
  EXTENSION_PRODUCT_POLICY,
} from "../extensions/product-policy";
import {
  invalidSkillsRequest as invalid,
  SKILLS_AUTHORITY_TTL_MS,
  skillsConflict as conflict,
  type HeldSkillsPlan,
} from "./service-authority";

export type UnifiedSkillsServiceDependencies = Readonly<{
  userData: string;
  userHome: string;
  env: NodeJS.ProcessEnv;
  registry: ExtensionRegistryStore;
  runtimeRegistry?: Pick<BackendRuntimeRegistry, "current" | "resolve">;
  chooseLocalFolder(): Promise<string | null>;
  library?: ManagedSkillsLibraryStore;
  jobs?: SkillsJobLedger;
  scanSkillsRoot?: typeof scanAgentSkillsRoot;
  invalidateCatalog?: () => void;
  custodyReferenced?: LibraryCustodyProbe;
}>;

export class UnifiedSkillsService {
  readonly library: ManagedSkillsLibraryStore;
  readonly jobs: SkillsJobLedger;
  private readonly targets: readonly ManagedSkillTarget[];
  private readonly userHome: string;
  private readonly imports = new Map<string, HeldImport>();
  private readonly plans = new Map<string, HeldSkillsPlan>();
  private readonly watchers = new Set<(snapshot: UnifiedSkillsSnapshot) => void>();
  private readonly progressWatchers = new Set<
    (progress: ManagedSkillJobProgress) => void
  >();
  private revision = 0;
  private lastCandidates: CandidateState = emptyCandidateState();
  private availability: UnifiedSkillsSnapshot["availability"] = {
    kind: "initializing",
  };
  private refreshEpoch = 0;
  private discoveryTask: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly unsubscribeInventory: () => void;

  constructor(private readonly dependencies: UnifiedSkillsServiceDependencies) {
    this.library =
      dependencies.library ?? new ManagedSkillsLibraryStore(dependencies.userData);
    this.jobs = dependencies.jobs ?? new SkillsJobLedger(dependencies.userData);
    this.userHome = resolveManagedSkillUserHome(
      dependencies.userHome,
      dependencies.env
    );
    this.targets = resolveManagedSkillTargets(this.userHome, dependencies.env);
    this.unsubscribeInventory = dependencies.registry.onInventoryChanged(() => {
      dependencies.invalidateCatalog?.();
      void this.serialize(async () => {
        this.revision += 1;
        await this.publish();
      }).catch(() => undefined);
    });
  }

  async initialize() {
    if (await this.initializeStores()) {
      await this.resumeJobs();
    }
    this.startBackgroundDiscovery();
  }

  onChanged(listener: (snapshot: UnifiedSkillsSnapshot) => void) {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  onProgress(listener: (progress: ManagedSkillJobProgress) => void) {
    this.progressWatchers.add(listener);
    return () => this.progressWatchers.delete(listener);
  }

  list(forceReload = false) {
    return this.serialize(async () => {
      await this.recoverIfReadOnly();
      if (forceReload || !this.lastCandidates.revision) {
        await this.refreshCandidates();
      }
      return this.projectSnapshot();
    });
  }

  candidates(agent: ManagedSkillAgent | "all", forceReload = false) {
    return this.serialize(async () => {
      if (agent !== "all" && !AGENTS.includes(agent)) {
        throw invalid("unknown Skill source");
      }
      if (forceReload || !this.lastCandidates.revision) {
        await this.refreshCandidates();
      }
      const candidates =
        agent === "all"
          ? AGENTS.flatMap(
              (source) => this.lastCandidates.byAgent.get(source) ?? []
            )
          : this.lastCandidates.byAgent.get(agent) ?? [];
      const authorities = new Map(
        candidates.map((candidate) => [candidate.ref, candidate])
      );
      const errors = this.lastCandidates.errors.filter(
        (error) => agent === "all" || error.agent === agent
      );
      return publicPreview(
        this.holdImport(
          agent,
          "",
          [...authorities.values()].map((candidate) => candidate.inspection),
          authorities,
          errors
        )
      );
    });
  }

  chooseLocal() {
    return this.serialize(async () => {
      const root = await this.dependencies.chooseLocalFolder();
      if (!root) return null;
      return publicPreview(
        this.holdImport(
          "local-folder",
          root,
          await inspectPackageFolder(root),
          undefined,
          []
        )
      );
    });
  }

  previewIntents(intents: readonly ManagedSkillIntentInput[]) {
    return this.serialize(async () => {
      this.assertWritable();
      if (!Array.isArray(intents) || !intents.length || intents.length > 2_048) {
        throw invalid("intent batch must contain 1-2048 items");
      }
      for (const [id, plan] of this.plans) {
        if (plan.view.expiresAt <= Date.now()) this.plans.delete(id);
      }
      const sources = await this.librarySources();
      const steps: SkillsJobStep[] = [];
      for (const intent of intents) {
        steps.push(
          ...(intent.type === "import-and-enable"
            ? await planImportIntent(intent, this.imports, this.library)
            : planExistingIntent(intent, sources))
        );
      }
      const planId = randomUUID();
      const planDigest = digestJson(steps);
      const view: ManagedSkillPlanPreview = {
        planId,
        planDigest,
        authorityToken: randomUUID(),
        expiresAt: Date.now() + SKILLS_AUTHORITY_TTL_MS,
        expectedRevision: this.revision,
        consent: steps.some((step) => step.action === "delete-library")
          ? [
              {
                kind: "delete",
                count: steps.filter(
                  (step) => step.action === "delete-library"
                ).length,
              },
            ]
          : [],
        total: steps.length,
        acquisitionActions: steps.filter((step) => step.action === "import")
          .length,
        enablementActions: steps.filter((step) =>
          step.action.startsWith("set-")
        ).length,
        deletionActions: steps.filter(
          (step) => step.action === "delete-library"
        ).length,
      };
      this.plans.set(planId, { view, steps });
      return view;
    });
  }

  applyPlan(input: Readonly<{
    planId: string;
    planDigest: `sha256:${string}`;
    authorityToken: string;
  }>) {
    return this.serialize(async () => {
      this.assertWritable();
      const held = this.plans.get(input?.planId);
      if (
        !held ||
        held.view.planDigest !== input.planDigest ||
        held.view.authorityToken !== input.authorityToken
      ) {
        throw conflict("plan authority is invalid");
      }
      if (held.view.expiresAt <= Date.now()) {
        throw conflict("plan authority expired");
      }
      if (held.view.expectedRevision !== this.revision) {
        throw conflict("Skills state changed; preview again");
      }
      this.plans.delete(input.planId);
      const job = await this.jobs.authorizePlan({ ...input, steps: held.steps });
      this.publishProgress(job.batchId);
      await this.runJob(job.batchId);
      this.revision += 1;
      this.dependencies.invalidateCatalog?.();
      const snapshot = await this.publish();
      void this.serialize(async () => {
        if (await this.refreshCandidates()) await this.publish();
      }).catch(() => undefined);
      return snapshot;
    });
  }

  undoPlan(undoToken: string) {
    return this.serialize(async () => {
      this.assertWritable();
      const job = this.jobs.jobForUndo(undoToken);
      if (!job) throw conflict("undo token is invalid or already consumed");
      await this.jobs.startUndo(job.batchId);
      for (const step of [...job.steps].reverse()) {
        if (step.status !== "completed" || step.previousEnabled === null) continue;
        if (
          (step.action === "import" ||
            step.action === "set-library-enabled") &&
          step.libraryId &&
          this.library.entry(step.libraryId)
        ) {
          await this.library.setEnabled(step.libraryId, step.previousEnabled);
        }
        if (
          step.action === "set-extension-enabled" &&
          step.componentInstanceIdentity
        ) {
          await this.setExtensionEnabled(
            step.componentInstanceIdentity,
            step.previousEnabled
          );
        }
      }
      await this.jobs.markUndone(job.batchId);
      this.revision += 1;
      this.dependencies.invalidateCatalog?.();
      return this.publish();
    });
  }

  async effectiveCandidates(
    projectContext: TurnProjectContext = {
      projectId: null,
      projectLifecycleRevision: null,
    }
  ): Promise<EffectiveSkillCandidate[]> {
    const inventory = this.dependencies.registry.visibleInventory(projectContext);
    const eligibleBackends = new Map<string, AgentBackendId[]>();
    for (const backend of ["codex", "claude", "kimi", "opencode"] as const) {
      const capability = buildExtensionCapabilitySnapshot({
        inventory,
        probe: backendExtensionProbe(
          backend,
          `${backend}:skills-current`,
          "current"
        ),
        policy: EXTENSION_PRODUCT_POLICY,
        selection: "effective",
      });
      for (const entry of capability.entries) {
        const values = eligibleBackends.get(entry.componentInstanceIdentity) ?? [];
        values.push(backend);
        eligibleBackends.set(entry.componentInstanceIdentity, values);
      }
    }
    return (await this.runtimeLibrarySources(projectContext)).map((source) => {
      if (source.local) {
        const generation = source.local.generations.find(
          (item) => item.generationId === source.local!.activeGenerationId
        )!;
        return {
          name: source.name,
          sourceKind: "library",
          ownerRef: source.ref,
          generationRef: {
            kind: "library",
            libraryId: source.local.libraryId,
            generationId: generation.generationId,
          },
          digest: source.digest,
          enabled: source.enabled,
          ...(source.requires ? { requires: source.requires } : {}),
          metadata: {
            description: source.description,
            displayName: source.displayName,
          },
          path: join(source.sourcePath, "SKILL.md"),
        };
      }
      return {
        name: source.name,
        sourceKind: "extension",
        ownerRef: source.ref,
        generationRef: {
          kind: "extension",
          componentInstanceIdentity:
            source.source.componentInstanceIdentity!,
          package: source.packageGenerationRef!,
        },
        digest: source.digest,
        enabled: source.enabled,
        ...(source.requires ? { requires: source.requires } : {}),
        metadata: {
          description: source.description,
          displayName: source.displayName,
        },
        path: source.sourcePath,
        extensionSelection: {
          installIdentity: source.source.installIdentity!,
          declaredComponentIdentity: source.declaredComponentIdentity!,
          ownerScope: source.ownerScope!,
          eligibleBackends:
            eligibleBackends.get(source.source.componentInstanceIdentity!) ?? [],
        },
      };
    });
  }

  async shutdown() {
    this.unsubscribeInventory();
    await this.discoveryTask?.catch(() => undefined);
    await this.library.closeAndFlush();
    await this.jobs.closeAndFlush();
  }

  private async initializeStores() {
    try {
      await this.library.initialize(
        this.dependencies.custodyReferenced ?? (() => false)
      );
      await this.jobs.initialize();
      this.availability = { kind: "ready" };
      return true;
    } catch (cause) {
      this.availability = { kind: "read-only", reason: safeReason(cause) };
      return false;
    }
  }

  private async recoverIfReadOnly() {
    if (this.availability.kind !== "read-only") return;
    if (await this.initializeStores()) await this.resumeJobs();
  }

  private async resumeJobs() {
    for (const job of this.jobs.resumableJobs()) {
      await this.runJob(job.batchId);
    }
  }

  private async runJob(batchId: string) {
    await this.jobs.start(batchId);
    for (const step of this.jobs.job(batchId)?.steps ?? []) {
      const current = this.jobs
        .job(batchId)
        ?.steps.find((candidate) => candidate.stepId === step.stepId);
      if (!current || current.status === "completed" || current.status === "failed") {
        continue;
      }
      await this.jobs.beginStep(batchId, step.stepId);
      try {
        await this.executeStep(batchId, step);
      } catch (cause) {
        await this.jobs.failStep(batchId, step.stepId, safeReason(cause));
      }
      this.publishProgress(batchId);
    }
    const job = this.jobs.job(batchId);
    if (!job) return;
    await this.jobs.finish(batchId, reportFor(job));
    this.publishProgress(batchId);
  }

  private async executeStep(batchId: string, step: SkillsJobStep) {
    if (step.action === "import") {
      if (!step.sourcePath || !step.sourceKind || !step.digest) {
        throw new Error("import receipt is incomplete");
      }
      const inspected = await inspectSkillFolder(step.sourcePath);
      if (!inspected.importable) throw new Error(`skill-inspection:${inspected.reason.code}`);
      const verified = await verifyInspectedSkill(inspected.skill);
      if (verified.digest !== step.digest || verified.name !== step.name) {
        throw Object.assign(new Error("import source changed"), { reason: "changed" });
      }
      const outcomes = await this.library.importCandidates([
        {
          skill: verified,
          source:
            step.sourceKind === "local-folder"
              ? { kind: "local-folder", sourcePath: step.sourcePath }
              : {
                  kind: "adopted",
                  agent: step.agent!,
                  sourcePath: step.sourcePath,
                },
        },
      ]);
      const outcome = outcomes[0]!;
      await this.jobs.checkpoint(batchId, step.stepId, {
        libraryId: outcome.libraryId,
        importOutcome: outcome.outcome,
      });
      return;
    }
    if (step.action === "set-library-enabled") {
      if (!step.libraryId || step.enabled === null) throw new Error("library gate receipt incomplete");
      await this.library.setEnabled(step.libraryId, step.enabled);
      await this.jobs.checkpoint(batchId, step.stepId);
      return;
    }
    if (step.action === "set-extension-enabled") {
      if (!step.componentInstanceIdentity || step.enabled === null) {
        throw new Error("extension gate receipt incomplete");
      }
      await this.setExtensionEnabled(
        step.componentInstanceIdentity,
        step.enabled
      );
      await this.jobs.checkpoint(batchId, step.stepId);
      return;
    }
    if (!step.libraryId) throw new Error("delete receipt incomplete");
    if (this.library.entry(step.libraryId)) {
      await this.library.delete(
        step.libraryId,
        this.dependencies.custodyReferenced ?? (() => false)
      );
    }
    await this.jobs.checkpoint(batchId, step.stepId);
  }

  private setExtensionEnabled(
    componentInstanceIdentity: string,
    enabled: boolean
  ) {
    return enabled
      ? this.dependencies.registry.enableComponent(componentInstanceIdentity)
      : this.dependencies.registry.disableComponent(componentInstanceIdentity);
  }

  private async projectSnapshot(): Promise<UnifiedSkillsSnapshot> {
    const installed = await this.installedAgents();
    const sources = await this.librarySources();
    const local = sources.filter((source) => source.local);
    return {
      revision: this.revision,
      availability: this.availability,
      library: sources.map((source) => ({
        ref: source.ref,
        name: source.name,
        displayName: source.displayName,
        description: source.description,
        ...(source.requires ? { requires: source.requires } : {}),
        digest: source.digest,
        source: source.source,
        enabled: source.enabled,
        allowedActions: source.local
          ? ([source.enabled ? "disable" : "enable", "delete"] as const)
          : ([
              source.enabled ? "disable" : "enable",
              "goto-package",
            ] as const),
      })),
      sources: sourceViews(this.lastCandidates, installed),
      candidates: {
        revision: this.lastCandidates.revision,
        unmanagedByAgent: this.lastCandidates.unmanagedByAgent,
        upToDateByAgent: this.lastCandidates.upToDateByAgent,
        unmanagedBytes: this.lastCandidates.unmanagedBytes,
        errors: this.lastCandidates.errors,
      },
      latestJob: this.jobs.latest(),
      personalLibraryEmpty: local.length === 0,
      enabledLibraryCount: local.filter((source) => source.enabled).length,
      enabledLibraryPromptBytes: estimateLibraryPromptBytes(local),
    };
  }

  private librarySources(
    projectContext: TurnProjectContext = {
      projectId: null,
      projectLifecycleRevision: null,
    }
  ) {
    return resolveLibrarySources({
      userData: this.dependencies.userData,
      library: this.library,
      registry: this.dependencies.registry,
      projectContext,
      projection: "management",
    });
  }

  private runtimeLibrarySources(projectContext: TurnProjectContext) {
    return resolveLibrarySources({
      userData: this.dependencies.userData,
      library: this.library,
      registry: this.dependencies.registry,
      projectContext,
      projection: "runtime-candidates",
    });
  }

  private async refreshCandidates() {
    const epoch = ++this.refreshEpoch;
    const installed = await this.installedAgents();
    const byAgent = new Map<ManagedSkillAgent, CandidateAuthority[]>();
    const errors: ManagedSkillCandidateError[] = [];
    const scanner = this.dependencies.scanSkillsRoot ?? scanAgentSkillsRoot;
    for (const target of this.targets) {
      if (!installed.has(target.agent)) {
        byAgent.set(target.agent, []);
        continue;
      }
      const candidates: CandidateAuthority[] = [];
      const seen = new Set<string>();
      for (const root of discoveryRoots(target, this.userHome)) {
        try {
          for (const inspection of await scanner(root)) {
            const sourcePath = inspection.importable
              ? inspection.skill.canonicalPath
              : join(root, inspection.name);
            if (seen.has(sourcePath)) continue;
            seen.add(sourcePath);
            candidates.push(
              candidateAuthority(target.agent, sourcePath, root, inspection)
            );
            if (!inspection.importable) {
              errors.push({
                agent: target.agent,
                label: inspection.name,
                reason: inspection.reason,
              });
            }
          }
        } catch (cause) {
          errors.push({
            agent: target.agent,
            label: "Skills discovery",
            reason: safeReason(cause),
          });
        }
      }
      byAgent.set(target.agent, candidates);
    }
    const owners = buildOwnerFacts(
      this.library
        .snapshot()
        .entries.filter((entry) => entry.tombstoneAt === null)
    );
    const unmanagedByAgent = emptyCounts();
    const upToDateByAgent = emptyCounts();
    const bytesByAgent = emptyCounts();
    let unmanagedBytes = 0;
    for (const agent of AGENTS) {
      const candidates = byAgent.get(agent) ?? [];
      const classified = classifyCandidates(candidates, owners);
      for (const candidate of candidates) {
        const status = classified.get(candidate.ref)?.status;
        if (status === "current") upToDateByAgent[agent] += 1;
        if (["new", "update"].includes(status ?? "")) {
          unmanagedByAgent[agent] += 1;
          if (candidate.inspection.importable) {
            bytesByAgent[agent] += candidate.inspection.skill.bytes;
            unmanagedBytes += candidate.inspection.skill.bytes;
          }
        }
      }
    }
    if (epoch !== this.refreshEpoch) return false;
    this.lastCandidates = {
      revision: privateIdentity(
        JSON.stringify(
          [...byAgent].flatMap(([agent, items]) =>
            items.map((item) => [
              agent,
              item.sourceIdentity,
              item.inspection.importable
                ? item.inspection.skill.revision
                : item.inspection.reason.code,
            ])
          )
        )
      ),
      byAgent,
      unmanagedByAgent,
      upToDateByAgent,
      bytesByAgent,
      unmanagedBytes,
      errors: dedupeErrors(errors),
    };
    return true;
  }

  private holdImport(
    source: ManagedSkillAgent | "local-folder" | "all",
    root: string,
    inspections: readonly SkillFolderInspection[],
    supplied?: ReadonlyMap<string, CandidateAuthority>,
    errors: readonly ManagedSkillCandidateError[] = []
  ) {
    for (const [id, prior] of this.imports) {
      if (prior.source === source) this.imports.delete(id);
    }
    if (source === "all" && !supplied) {
      throw invalid("aggregate imports require discovered authorities");
    }
    const authorities =
      supplied ??
      new Map(
        inspections.map((inspection) => {
          const path = inspection.importable
            ? inspection.skill.canonicalPath
            : root;
          const authority = candidateAuthority(
            source as Exclude<typeof source, "all">,
            path,
            root,
            inspection
          );
          return [authority.ref, authority] as const;
        })
      );
    const classifications = classifyCandidates(
      authorities.values(),
      buildOwnerFacts(
        this.library
          .snapshot()
          .entries.filter((entry) => entry.tombstoneAt === null)
      )
    );
    const candidates = [...authorities.values()].map((authority) =>
      candidateView(authority, classifications.get(authority.ref)!)
    );
    const held: HeldImport = {
      previewId: randomUUID(),
      revision: privateIdentity(
        JSON.stringify(
          candidates.map((candidate) => [
            candidate.ref,
            candidate.revision,
            candidate.digest,
          ])
        )
      ),
      source,
      candidates,
      errors,
      authorities,
    };
    this.imports.set(held.previewId, held);
    return held;
  }

  private installedAgents() {
    if (!this.dependencies.runtimeRegistry) {
      return Promise.resolve(new Set<ManagedSkillAgent>(AGENTS));
    }
    return Promise.all(
      AGENTS.map(async (agent) => {
        const snapshot =
          this.dependencies.runtimeRegistry!.current(agent) ??
          (await this.dependencies.runtimeRegistry!.resolve(agent).catch(
            () => null
          ));
        return snapshot?.runtimeStatus === "installed" ? agent : null;
      })
    ).then(
      (agents) =>
        new Set(
          agents.filter((agent): agent is ManagedSkillAgent => Boolean(agent))
        )
    );
  }

  private startBackgroundDiscovery() {
    if (this.discoveryTask) return;
    this.discoveryTask = this.serialize(async () => {
      if (await this.refreshCandidates()) await this.publish();
    })
      .catch(() => undefined)
      .finally(() => {
        this.discoveryTask = null;
      });
  }

  private serialize<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
  private assertWritable() {
    if (this.availability.kind !== "ready") {
      throw Object.assign(new Error("Skills management is read-only"), {
        status: 503,
      });
    }
  }

  private publishProgress(batchId: string) {
    const progress = this.jobs.progress(batchId);
    if (!progress) return;
    for (const watcher of this.progressWatchers) watcher(progress);
  }

  private async publish() {
    const snapshot = await this.projectSnapshot();
    for (const watcher of this.watchers) watcher(snapshot);
    return snapshot;
  }
}
