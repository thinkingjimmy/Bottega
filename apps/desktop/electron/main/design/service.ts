/**
 * [INPUT]: Depends on Design custody/enabled/registry/history/lifecycle journals/shared storage operations/provisioning/workspace/watcher modules, effective-workspace and live-surface adapters, and explicit deletion filesystem authority
 * [OUTPUT]: Provides DesignService, factory lifecycle, preview/history ports, serialized turn capture with retired-owner fencing, main-evidence Project owner migration, and crash-recoverable custody deletion/replacement
 * [POS]: Design's composition root; installation, Project rebind, and renderer layers consume narrow methods instead of reaching into durable ledgers
 */

import { rm } from "node:fs/promises";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import {
  CanvasRegistry,
  type CanvasProvenance,
} from "./storage/canvas-registry";
import { DesignCustodyLedger } from "./storage/custody-ledger";
import {
  DESIGN_FACTORY_CUSTODY_SLOT,
  DESIGN_PRESET_ID,
  DesignEnabled,
  type DesignAppRegistry,
} from "./enabled";
import { VersionHistory } from "./storage/version-history";
import { OwnerMigrationJournal } from "./storage/owner-migration";
import { CustodyDeletionJournal } from "./storage/custody-deletion";
import { DesignStorageOperations } from "./storage/operations";
import {
  DesignWorkspaceAccess,
  type DesignSurface,
  type DesignSurfaceBinding,
  type DesignWorkspaceIdentity,
} from "./workspace-access";
import { DesignWatcher } from "./watcher";
import {
  DesignFactoryProvisioner,
  type DesignFactoryPorts,
  type DesignFactoryTrust,
} from "./provisioning/factory-provisioner";

type WorkspacePorts = Readonly<{
  describeSurface(surfaceLeaseId: string): Promise<DesignSurface> | DesignSurface;
  resolveEffectiveWorkspace: EffectiveWorkspaceResolver;
}>;
export type DesignEvent =
  | Readonly<{
      type: "canvases-changed";
      appId: string;
      chatId: string;
      conversationIncarnationId: string;
      turnId: string;
      files: readonly string[];
      drafting: boolean;
    }>
  | Readonly<{
      type: "workspace-authority-changed";
      appId: string;
      authorityIdentity: string;
    }>;

export type DesignProjectRebindEvidence = Readonly<{
  operationId: string;
  projectId: string;
  sourceBinding:
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "external"; capabilityId: string }>
    | Readonly<{ kind: "app"; appId: string }>;
  targetBinding: Readonly<{ kind: "external"; capabilityId: string }>;
}>;

export class DesignService {
  readonly enabled: DesignEnabled;
  readonly custody: DesignCustodyLedger;
  readonly registry: CanvasRegistry;
  readonly history: VersionHistory;
  readonly ownerMigrations: OwnerMigrationJournal;
  readonly custodyDeletions: CustodyDeletionJournal;
  readonly watcher: DesignWatcher;
  readonly factory: DesignFactoryProvisioner;
  private readonly storageOperations = new DesignStorageOperations();
  private access: DesignWorkspaceAccess | null = null;
  private emit: (event: DesignEvent) => void = () => undefined;
  private readonly draftingScopes = new Set<string>();

  constructor(userData: string, private readonly apps: DesignAppRegistry) {
    this.enabled = new DesignEnabled(apps);
    this.custody = new DesignCustodyLedger(userData);
    this.registry = new CanvasRegistry(userData);
    this.history = new VersionHistory(userData);
    this.watcher = new DesignWatcher(userData);
    this.ownerMigrations = new OwnerMigrationJournal(
      userData,
      this.registry,
      this.history,
      this.storageOperations
    );
    this.custodyDeletions = new CustodyDeletionJournal(
      userData,
      this.storageOperations,
      {
        custodyPath: (dataCustodyId) =>
          this.custody.pathFor({ dataCustodyId }),
        fenceWatcher: (workspace) => this.watcher.fenceWorkspace(workspace),
        terminateRegistry: (ownerId) => this.registry.terminateOwner(ownerId),
        terminateHistory: (ownerId) => this.history.terminateOwner(ownerId),
        deleteFiles: (workspace) => rm(workspace, { recursive: true, force: true }),
        tombstoneCustody: (dataCustodyId) =>
          this.custody.explicitlyDelete(dataCustodyId),
        shouldActivateReplacement: (input) => {
          const app = this.apps.get(input.appId);
          return app?.presetId === input.presetId &&
            input.presetId === DESIGN_PRESET_ID;
        },
        activateReplacement: (input) => this.custody.activateFresh(input),
      }
    );
    this.factory = new DesignFactoryProvisioner(userData);
  }

  async initialize() {
    await Promise.all([
      this.custody.initialize(),
      this.registry.initialize(),
      this.history.initialize(),
      this.watcher.initialize(),
      this.factory.initialize(),
    ]);
    await this.ownerMigrations.initialize();
    await this.custodyDeletions.initialize();
  }

  configureWorkspace(ports: WorkspacePorts) {
    if (this.access) throw new Error("Design workspace authority 已配置");
    this.access = new DesignWorkspaceAccess(this.registry, {
      ...ports,
      enabled: this.enabled,
    });
  }

  configureEvents(emit: (event: DesignEvent) => void) {
    this.emit = emit;
  }

  configureFactory(ports: DesignFactoryPorts) {
    this.factory.configure(ports);
  }

  ensureFactory(sourceRoot: string, trust: DesignFactoryTrust) {
    return this.factory.ensure(sourceRoot, trust);
  }

  resetFactoryToPin(sourceRoot: string, trust: DesignFactoryTrust) {
    return this.factory.resetToPin(sourceRoot, trust);
  }

  reinstallFactory(sourceRoot: string, trust: DesignFactoryTrust) {
    return this.factory.reinstall(sourceRoot, trust);
  }

  isEnabled() {
    return this.enabled.isEnabled();
  }

  isDesignSkillPath(path: string) {
    return /(?:^|[/\\])skills[/\\]design[/\\]SKILL\.md$/.test(path);
  }

  skillEnabledForPath(path: string) {
    return this.isDesignSkillPath(path) ? this.isEnabled() : null;
  }

  resolveAppData(appId: string) {
    const entry = this.custody.activeForApp(appId);
    return entry
      ? {
          workspace: this.custody.pathFor(entry),
          authorityIdentity: `data:${entry.dataCustodyId}:${entry.updatedAt}`,
          stableWorkspaceOwnerId: `data:${entry.dataCustodyId}`,
          dataCustodyId: entry.dataCustodyId,
        }
      : undefined;
  }

  activateFactoryCustody(appId: string) {
    // 通过串行边界路由：custody 激活必须与删除 saga 串行，避免复活一个正处于
    // 删除中的 slot。调用方（factory ensure）不持有该队列，无重入死锁风险。
    return this.storageOperations.run(() =>
      this.custody.activate({
        custodySlotId: DESIGN_FACTORY_CUSTODY_SLOT,
        appId,
        presetId: DESIGN_PRESET_ID,
      })
    );
  }

  listWorkspaceDesignFiles(binding: DesignSurfaceBinding) {
    return this.storageOperations.run(async () => {
      const access = this.requireAccess();
      const resolved = await access.resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      const listing = await access.listResolved(resolved);
      return {
        ...listing,
        drafting: this.draftingScopes.has(designScopeKey(
          resolved.surface.conversationId,
          resolved.surface.conversationIncarnationId
        )),
      };
    });
  }

  listImportCandidates(binding: DesignSurfaceBinding) {
    return this.storageOperations.run(async () => {
      const access = this.requireAccess();
      const resolved = await access.resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      return access.listImportCandidates(resolved);
    });
  }

  readWorkspaceDesignFile(
    binding: DesignSurfaceBinding,
    relativePath: string
  ) {
    return this.storageOperations.run(async () => {
      const access = this.requireAccess();
      const resolved = await access.resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      return access.readRegisteredResolved(resolved, relativePath);
    });
  }

  readCanvasForTool(
    resolved: DesignWorkspaceIdentity,
    relativePath: string
  ) {
    return this.storageOperations.run(async () => {
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      return this.requireAccess().readRegisteredResolved(resolved, relativePath);
    });
  }

  async importCanvas(
    binding: DesignSurfaceBinding,
    relativePath: string,
    provenance: CanvasProvenance = {}
  ) {
    return this.storageOperations.run(async () => {
      const access = this.requireAccess();
      const resolved = await access.resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      const imported = await access.importResolved(
        resolved,
        relativePath,
        provenance
      );
      await this.history.capture({
        stableWorkspaceOwnerId: imported.resolved.stableWorkspaceOwnerId,
        relativePath: imported.entry.canonicalRelativePath,
        content: imported.content,
        source: "manual",
        provenance,
      });
      return imported.entry;
    });
  }

  async restoreVersion(binding: DesignSurfaceBinding, versionId: string) {
    return this.storageOperations.run(async () => {
      const access = this.requireAccess();
      const resolved = await access.resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      const { version, content } = await this.history.readVersion(versionId);
      if (version.stableWorkspaceOwnerId !== resolved.stableWorkspaceOwnerId) {
        throw Object.assign(new Error("Canvas version workspace 不匹配"), { status: 403 });
      }
      await access.writeRegistered(
        resolved,
        version.canonicalRelativePath,
        content
      );
      const restored = await this.history.capture({
        stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
        relativePath: version.canonicalRelativePath,
        content,
        source: "restore",
        restoredFromVersion: version.versionId,
      });
      await this.registry.register({
        stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
        relativePath: version.canonicalRelativePath,
        digest: restored.digest,
        // 转发被还原版本的 provenance：不传则登记行的 chatId/incarnation/turnId
        // 会被清成空，丢失该 canvas 的作者归属。
        provenance: version.provenance,
      });
      return restored;
    });
  }

  async listVersions(binding: DesignSurfaceBinding, relativePath: string) {
    return this.storageOperations.run(async () => {
      const resolved = await this.requireAccess().resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      const entry = this.registry.get(
        resolved.stableWorkspaceOwnerId,
        relativePath
      );
      if (!entry) throw Object.assign(new Error("Canvas 未登记"), { status: 404 });
      return this.history.list(
        resolved.stableWorkspaceOwnerId,
        entry.canonicalRelativePath
      );
    });
  }

  async readVersion(binding: DesignSurfaceBinding, versionId: string) {
    return this.storageOperations.run(async () => {
      const resolved = await this.requireAccess().resolveBinding(binding);
      this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
      const version = await this.history.readVersion(versionId);
      if (version.version.stableWorkspaceOwnerId !== resolved.stableWorkspaceOwnerId) {
        throw Object.assign(new Error("Canvas version workspace 不匹配"), { status: 403 });
      }
      return version;
    });
  }

  async armTurn(input: {
    appId: string;
    workspace: string;
    authorityIdentity: string;
    stableWorkspaceOwnerId: string;
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
  }) {
    const access = this.requireAccess();
    if (!this.enabled.isAppEnabled(input.appId)) return false;
    const resolved: DesignWorkspaceIdentity = {
      workspace: input.workspace,
      authorityIdentity: input.authorityIdentity,
      stableWorkspaceOwnerId: input.stableWorkspaceOwnerId,
    };
    this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
    const baseline = new Map(
      (await access.snapshotDesignFiles(resolved)).map((file) => [
        file.path,
        file.digest,
      ] as const)
    );
    const candidateBaseline = new Map(
      (await access.snapshotCandidateStates(resolved)).map((file) => [
        file.path,
        file.signature,
      ] as const)
    );
    const scopeKey = designScopeKey(input.chatId, input.conversationIncarnationId);
    const provenance = {
      chatId: input.chatId,
      conversationIncarnationId: input.conversationIncarnationId,
      turnId: input.turnId,
    };
    await this.watcher.arm({
      chatId: input.chatId,
      conversationIncarnationId: input.conversationIncarnationId,
      turnId: input.turnId,
      workspace: resolved.workspace,
      refresh: () => this.storageOperations.run(async () => {
        this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
        const candidates = await access.snapshotCandidateStates(resolved);
        const rawChanged = candidates.some(
          (candidate) => candidateBaseline.get(candidate.path) !== candidate.signature
        ) || [...candidateBaseline.keys()].some(
          (path) => !candidates.some((candidate) => candidate.path === path)
        );
        candidateBaseline.clear();
        for (const candidate of candidates) candidateBaseline.set(candidate.path, candidate.signature);
        const files = await access.scanAndRegister(resolved, provenance, baseline);
        return { files, drafting: rawChanged && files.length === 0 };
      }),
      onDrafting: () => {
        this.draftingScopes.add(scopeKey);
        this.emit({
          type: "canvases-changed",
          appId: input.appId,
          chatId: input.chatId,
          conversationIncarnationId: input.conversationIncarnationId,
          turnId: input.turnId,
          files: [],
          drafting: true,
        });
      },
      onChanged: (files) => {
        this.draftingScopes.delete(scopeKey);
        this.emit({
          type: "canvases-changed",
          appId: input.appId,
          chatId: input.chatId,
          conversationIncarnationId: input.conversationIncarnationId,
          turnId: input.turnId,
          files,
          drafting: false,
        });
      },
      onSettled: async (files) => {
        this.draftingScopes.delete(scopeKey);
        await this.captureTurnHistory(files, resolved, provenance);
      },
      onFinished: () => {
        this.draftingScopes.delete(scopeKey);
      },
    });
    return true;
  }

  async settleTurn(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
  }) {
    this.watcher.settle(input);
  }

  private async captureTurnHistory(
    files: readonly string[],
    resolved: DesignWorkspaceIdentity,
    provenance: CanvasProvenance
  ) {
    const failures: unknown[] = [];
    for (const file of files) {
      try {
        await this.storageOperations.run(async () => {
          this.assertOwnerWritable(resolved.stableWorkspaceOwnerId);
          await this.history.capture({
            stableWorkspaceOwnerId: resolved.stableWorkspaceOwnerId,
            relativePath: file,
            content: await this.requireAccess().readResolved(resolved, file),
            source: "ai",
            provenance,
          });
        });
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length) {
      throw new AggregateError(
        failures,
        `Design terminal capture skipped ${failures.length} dirty file(s)`
      );
    }
  }

  suppressAutoOpen(input: {
    chatId: string;
    conversationIncarnationId: string;
  }) {
    return this.watcher.suppress({
      chatId: input.chatId,
      conversationIncarnationId: input.conversationIncarnationId,
    });
  }

  clearAutoOpenSuppression(input: {
    chatId: string;
    conversationIncarnationId: string;
  }) {
    return this.watcher.clearSuppression({
      chatId: input.chatId,
      conversationIncarnationId: input.conversationIncarnationId,
    });
  }

  async deleteCustodyData(input: {
    appId: string;
    dataCustodyId: string;
    confirmed: true;
  }) {
    if (input.confirmed !== true) throw new Error("Design data deletion 需要确认");
    const entry = this.custody
      .list()
      .find((candidate) => candidate.dataCustodyId === input.dataCustodyId);
    if (!entry || entry.state === "explicitly-deleted") return null;
    if (entry.appId !== input.appId || entry.state !== "active") {
      throw Object.assign(new Error("Design data custody 不属于当前 App"), {
        status: 403,
      });
    }
    const deletion = await this.custodyDeletions.delete(entry);
    const replacement = deletion.replacementDataCustodyId
      ? this.custody.list().find(
          (candidate) =>
            candidate.dataCustodyId === deletion.replacementDataCustodyId &&
            candidate.state === "active"
        ) ?? null
      : null;
    if (replacement) {
      this.emit({
        type: "workspace-authority-changed",
        appId: input.appId,
        authorityIdentity: `data:${replacement.dataCustodyId}:${replacement.updatedAt}`,
      });
    }
    return { deleted: entry, replacement };
  }

  migrateProjectWorkspace(evidence: DesignProjectRebindEvidence) {
    const input = assertProjectRebindEvidence(evidence);
    if (input.sourceBinding.kind !== "external") return Promise.resolve(null);
    return this.ownerMigrations.migrateProjectBinding({
      operationId: input.operationId,
      projectId: input.projectId,
      sourceCapabilityId: input.sourceBinding.capabilityId,
      targetCapabilityId: input.targetBinding.capabilityId,
    });
  }

  orphanApp(appId: string) {
    return this.custody.orphanApp(appId);
  }

  markFactoryDeleted(appId: string) {
    return this.factory.markDeleted(appId);
  }

  async closeAndFlush() {
    await this.watcher.closeAndFlush();
    await this.custodyDeletions.drain();
    await this.storageOperations.closeAndFlush();
    await Promise.all([
      this.history.closeAndFlush(),
      this.ownerMigrations.closeAndFlush(),
      this.custodyDeletions.closeAndFlush(),
      this.registry.closeAndFlush(),
      this.custody.closeAndFlush(),
      this.factory.closeAndFlush(),
    ]);
  }

  private requireAccess() {
    if (!this.access) throw new Error("Design workspace authority 尚未配置");
    return this.access;
  }

  private assertOwnerWritable(stableWorkspaceOwnerId: string) {
    if (this.ownerMigrations.isOwnerRetired(stableWorkspaceOwnerId)) {
      throw Object.assign(new Error("Design workspace owner 已因 Project rebind 退役"), {
        status: 410,
      });
    }
    if (this.custodyDeletions.isOwnerFenced(stableWorkspaceOwnerId)) {
      throw Object.assign(new Error("Design workspace custody 已进入删除 intent"), {
        status: 410,
      });
    }
  }
}

function designScopeKey(chatId: string, conversationIncarnationId: string) {
  return `${chatId}\0${conversationIncarnationId}`;
}

function assertProjectRebindEvidence(value: unknown): DesignProjectRebindEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Design Project rebind evidence 无效");
  }
  const input = value as Record<string, unknown>;
  const keys = ["operationId", "projectId", "sourceBinding", "targetBinding"];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !(key in input))) {
    throw new Error("Design Project rebind evidence 无效");
  }
  if (
    typeof input.operationId !== "string" ||
    !/^project-rebind:[0-9a-f-]{36}$/i.test(input.operationId) ||
    typeof input.projectId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.projectId) ||
    !isSourceBinding(input.sourceBinding) ||
    !isExternalBinding(input.targetBinding)
  ) {
    throw new Error("Design Project rebind evidence 无效");
  }
  return input as DesignProjectRebindEvidence;
}

function isSourceBinding(value: unknown): value is DesignProjectRebindEvidence["sourceBinding"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  if (binding.kind === "none") return Object.keys(binding).length === 1;
  if (binding.kind === "external") return isExternalBinding(binding);
  return binding.kind === "app" &&
    Object.keys(binding).length === 2 &&
    typeof binding.appId === "string" &&
    /^[a-z0-9]{10}$/.test(binding.appId);
}

function isExternalBinding(value: unknown): value is Readonly<{
  kind: "external";
  capabilityId: string;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return binding.kind === "external" &&
    Object.keys(binding).length === 2 &&
    typeof binding.capabilityId === "string" &&
    /^[A-Za-z0-9_-]{10,64}$/.test(binding.capabilityId);
}
