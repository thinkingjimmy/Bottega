/**
 * [INPUT]: AppStore generation/consent commands, preset sources, source mutation sequencing and durable update files.
 * [OUTPUT]: Independent Base App prepare/status/decide/retry/recover with fact-based promotion and recoverable source custody.
 * [POS]: Update transaction owner; promotion remains the sole runtime commit and Base rows are never imported or migrated.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PresetUpdateStatus } from "../../../../shared/ipc/apps/apps-ipc";
import type { AppStore } from "../store/app-store";
import { AppMutationCoordinator } from "../source/app-source-coordinator";
import { appManifestSchema } from "../install/manifest-schema";
import { authorizePendingGeneration } from "../install/delivery/authorization";
import { baseSnapshotFileSchema } from "../../../../shared/bases/model/base-snapshot";
import { canonicalJson, sha256 } from "../support";
import { instanceFence, promotionFence, transactionSchema, type UpdateTransaction } from "./contract";
import { UpdateFiles } from "./files";
import type { UpdateSource } from "./source";
import { assertUpdateIdle } from "./guard";

type UpdatePorts = {
  mutations?: AppMutationCoordinator;
  checkpoint?(phase: string): Promise<void>;
  sourceSynchronized?(appId: string): Promise<void>;
  synchronizeRuntime?(appId: string): Promise<void>;
  settleLedger?(appId: string, generationId: string): Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 3500);
export class PresetUpdateService {
  private readonly files: UpdateFiles;
  private readonly transactions = new Map<string, UpdateTransaction>();
  private readonly mutations: AppMutationCoordinator;
  private readonly checkpoint: (phase: string) => Promise<void>;
  constructor(userData: string, private readonly apps: AppStore, private readonly source: UpdateSource, private readonly ports: UpdatePorts = {}) {
    this.files = new UpdateFiles(userData); this.mutations = ports.mutations ?? new AppMutationCoordinator();
    this.checkpoint = ports.checkpoint ?? (async () => undefined);
  }
  configured() { return this.source.available?.() ?? true; }
  status(appId: string): PresetUpdateStatus | null {
    const tx = this.transactions.get(appId);
    if (!tx) return null;
    const record = this.apps.get(appId), pending = record?.generationBinding.pending;
    const generation = record?.generations.find(value => value.generationId === tx.pendingGenerationId);
    return { operationId: tx.operationId, version: tx.descriptor.version, state: tx.state,
      descriptorDigest: tx.descriptorDigest, error: tx.error ?? null,
      capabilities: pending?.baseGuiDecision?.requestedCapabilities ?? [],
      hostActions: pending?.baseGuiDecision?.requestedHostActions ?? [],
      extensions: generation?.manifest.extensionRequirements?.map(value => value.declaredComponentIdentity) ?? [],
      backupPath: record ? this.files.backup(record.dir, tx.operationId) : null };
  }
  backupPath(appId: string, operationId: string) { return this.files.backup(this.require(appId).dir, operationId); }
  prepare(appId: string) { return this.mutations.run(appId, () => this.prepareHeld(appId)); }
  private async prepareHeld(appId: string) {
    const record = this.require(appId); assertUpdateIdle(record);
    if (record.origin !== "preset" || !record.presetId || record.manifest?.kind !== "base" || !record.manifest.gui ||
      record.state !== "ready" || !record.enabled || record.generationBinding.pending || !record.generationBinding.active || this.apps.portable.isCloudManaged(appId)) {
      throw new Error("APP_UPDATE_INSTANCE_UNAVAILABLE");
    }
    const operationId = randomUUID(), now = Date.now(), sourceDigest = await this.files.digest(record.dir);
    let tx: UpdateTransaction | undefined;
    try {
      const update = await this.source.fetch(record.presetId, this.files.candidate(operationId));
      this.source.verify(update, record.presetId);
      if (update.descriptor.sourceCommitSha === record.installedPresetPin) {
        await this.files.cleanup({ operationId } as UpdateTransaction); return null;
      }
      tx = transactionSchema.parse({ schemaVersion: 1, operationId, appId, descriptor: update.descriptor, descriptorDigest: sha256(Buffer.from(canonicalJson(update.descriptor))),
        state: "frozen", previousStudioGrant: record.studioGrant ?? null, originalActiveGenerationId: record.generationBinding.active!.generationId, instanceFence: instanceFence(record), sourceDigest, createdAt: now, updatedAt: now });
      await this.files.save(tx);
      await this.apps.update(appId, current => {
        assertUpdateIdle(current);
        if (instanceFence(current) !== tx!.instanceFence) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
        return { ...current, presetUpdate: { operationId, targetVersion: update.descriptor.version, state: "frozen" } };
      });
      this.transactions.set(appId, tx);
      await this.build(tx);
      return this.status(appId);
    } catch (error) {
      if (tx && this.apps.get(appId)?.presetUpdate?.operationId === operationId) await this.fail(tx, error);
      else await this.files.cleanup({ operationId } as UpdateTransaction).catch(() => undefined);
      throw error;
    }
  }
  decide(appId: string, operationId: string, approve: boolean) {
    return this.mutations.run(appId, async () => {
      const tx = this.transactions.get(appId);
      if (!tx || tx.operationId !== operationId || tx.state !== "awaiting-consent") throw new Error("APP_UPDATE_CONSENT_STALE");
      if (!approve) { await this.fail(tx, new Error("APP_UPDATE_DECLINED")); return null; }
      try {
        await this.validatePending(tx);
        tx.userConsentAt = Date.now(); await this.files.save(tx);
        await this.authorize(tx);
        await this.commit(tx);
      } catch (error) {
        if (this.isCommitted(tx)) await this.postCommit(tx, error); else { await this.fail(tx, error); throw error; }
      }
      return this.status(appId);
    });
  }
  retry(appId: string) {
    return this.mutations.run(appId, async () => {
      const tx = this.transactions.get(appId);
      if (!tx || !this.isCommitted(tx)) throw new Error("APP_UPDATE_RECOVERY_UNAVAILABLE");
      await this.postCommit(tx); return this.status(appId);
    });
  }
  async recover() {
    for (const operationId of await this.files.list()) {
      try {
        const tx = await this.files.read(operationId);
        await this.mutations.run(tx.appId, async () => {
          const record = this.apps.get(tx.appId);
          if (!record || record.presetUpdate?.operationId !== operationId) {
            // A cleared marker is the durable completion/abort receipt. Never infer permission from an orphan candidate.
            if (tx.state === "completed" || tx.state === "failed" || tx.state === "frozen") await this.files.cleanup(tx);
            return;
          }
          this.transactions.set(tx.appId, tx);
          try {
            this.source.verify({ descriptor: tx.descriptor }, record.presetId!, tx.createdAt);
            if (this.isCommitted(tx)) { await this.postCommit(tx); return; }
            if (tx.state === "completed" || tx.state === "failed") { await this.fail(tx, new Error(tx.error ?? "APP_UPDATE_INTERRUPTED")); return; }
            if (tx.state === "frozen" || tx.state === "validated") {
              if (record.generationBinding.pending) await this.adoptBuilt(tx); else await this.build(tx);
            }
            if (tx.state === "pending-built") await this.setState(tx, "awaiting-consent");
            if (tx.state === "consent-resolved") { await this.commit(tx); return; }
            if (tx.state === "awaiting-consent" && tx.userConsentAt) {
              // Only a durably recorded decision may resume partial grant writes.
              await this.authorize(tx); await this.commit(tx); return;
            }
            await this.validatePending(tx);
          } catch (error) {
            if (this.isCommitted(tx)) await this.postCommit(tx, error); else await this.fail(tx, error);
          }
        });
      } catch (error) { console.warn(`[apps] Update recovery requires attention: ${operationId}`, error); }
    }
  }
  private require(appId: string) { const record = this.apps.get(appId); if (!record) throw new Error("APP_UPDATE_INSTANCE_MISSING"); return record; }
  private async verifyFrozen(tx: UpdateTransaction) {
    this.source.verify({ descriptor: tx.descriptor }, this.require(tx.appId).presetId!, tx.createdAt);
    if (sha256(Buffer.from(canonicalJson(tx.descriptor))) !== tx.descriptorDigest) throw new Error("APP_UPDATE_DESCRIPTOR_CHANGED");
    await this.files.verifyCandidate(tx);
  }
  private async build(tx: UpdateTransaction) {
    await this.verifyFrozen(tx);
    const record = this.require(tx.appId);
    if (instanceFence(record) !== tx.instanceFence) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
    if (await this.files.digest(record.dir) !== tx.sourceDigest) throw new Error("APP_UPDATE_SOURCE_CHANGED");
    const candidate = this.files.candidate(tx.operationId), manifest = appManifestSchema.parse(JSON.parse(await readFile(join(candidate, "app.json"), "utf8")));
    if (manifest.kind !== "base" || !manifest.gui) throw new Error("APP_UPDATE_BASE_REQUIRED");
    if (canonicalJson(manifest.extensionRequirements ?? []) !== canonicalJson(record.manifest?.extensionRequirements ?? [])) throw new Error("APP_UPDATE_EXTENSION_CHANGE_UNSUPPORTED");
    const activeId = record.generationBinding.active!.generationId;
    const oldRoot = join(this.apps.artifactRoot(tx.appId, activeId), "source");
    const schema = async (root: string) => {
      const snapshot = baseSnapshotFileSchema.parse(JSON.parse(await readFile(join(root, "data/base.json"), "utf8")));
      return canonicalJson({ columns: snapshot.columns, views: snapshot.views });
    };
    if (await schema(candidate) !== await schema(oldRoot)) throw new Error("APP_UPDATE_SCHEMA_CHANGE_UNSUPPORTED");
    await this.setState(tx, "validated");
    const buildRoot = await this.files.prepareBuild(tx);
    await this.checkpoint("before-build");
    await this.apps.publishGeneration(tx.appId, current => {
      if (instanceFence(current) !== tx.instanceFence || current.presetUpdate?.operationId !== tx.operationId) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
      return { ...current, manifest };
    }, { generationSourceDir: buildRoot, updateOperationId: tx.operationId });
    await this.adoptBuilt(tx);
    await this.setState(tx, "awaiting-consent");
  }
  private async adoptBuilt(tx: UpdateTransaction) {
    const record = this.require(tx.appId), pending = record.generationBinding.pending;
    if (!pending || record.presetUpdate?.operationId !== tx.operationId) throw new Error("APP_UPDATE_PENDING_LOST");
    tx.pendingGenerationId = pending.generationId; tx.expectedConsentRevision = pending.expectedConsentRevision;
    tx.publicationFence = instanceFence(record); tx.promotionFence = promotionFence(record);
    await this.setState(tx, "pending-built");
  }
  private async validatePending(tx: UpdateTransaction) {
    await this.verifyFrozen(tx);
    const record = this.require(tx.appId);
    if (record.presetUpdate?.operationId !== tx.operationId || record.generationBinding.pending?.generationId !== tx.pendingGenerationId) throw new Error("APP_UPDATE_PENDING_LOST");
    if (promotionFence(record) !== tx.promotionFence) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
    if (!tx.userConsentAt && instanceFence(record) !== tx.publicationFence) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
    if (await this.files.digest(record.dir) !== tx.sourceDigest) throw new Error("APP_UPDATE_SOURCE_CHANGED");
  }
  private async authorize(tx: UpdateTransaction) {
    await this.validatePending(tx);
    const pending = this.require(tx.appId).generationBinding.pending!;
    tx.grantedCapabilities = [...(pending.baseGuiDecision?.requestedCapabilities ?? [])];
    tx.grantedHostActions = [...(pending.baseGuiDecision?.requestedHostActions ?? [])];
    tx.grantedCapabilityScopes = pending.baseGuiDecision?.requestedCapabilityScopes ?? {};
    const current = async () => {
      const record = this.require(tx.appId);
      if (record.presetUpdate?.operationId !== tx.operationId || record.generationBinding.pending?.generationId !== tx.pendingGenerationId) throw new Error("APP_UPDATE_CONSENT_STALE");
    };
    const record = await authorizePendingGeneration(this.apps, tx.appId, { scope: "studio-only", decision: "approve-requested" }, true, current);
    if (record.generationBinding.pending?.state !== "ready-to-promote") throw new Error("APP_UPDATE_AUTHORIZATION_INCOMPLETE");
    tx.studioGranted = true; tx.expectedConsentRevision = record.generationBinding.pending.expectedConsentRevision;
    await this.setState(tx, "consent-resolved");
  }
  private isCommitted(tx: UpdateTransaction) {
    return Boolean(tx.pendingGenerationId && this.apps.get(tx.appId)?.generationBinding.active?.generationId === tx.pendingGenerationId);
  }
  private async commit(tx: UpdateTransaction) {
    if (!tx.userConsentAt || !tx.pendingGenerationId) throw new Error("APP_UPDATE_CONSENT_REQUIRED");
    await this.validatePending(tx);
    try { await this.apps.promotePendingGeneration(tx.appId, tx.expectedConsentRevision!); }
    catch (error) {
      if (!this.isCommitted(tx)) throw error;
      tx.ledgerFailed = true; tx.ledgerError = message(error); await this.files.save(tx);
    }
    if (!this.isCommitted(tx)) throw new Error("APP_UPDATE_ACTIVE_MISMATCH");
    tx.activeGenerationId = tx.pendingGenerationId; await this.setState(tx, "committed"); await this.postCommit(tx);
  }
  private async postCommit(tx: UpdateTransaction, cause?: unknown) {
    try {
      if (!this.isCommitted(tx)) throw new Error("APP_UPDATE_ACTIVE_MISMATCH");
      tx.activeGenerationId = tx.pendingGenerationId;
      await this.setState(tx, "post-commit");
      await this.checkpoint("before-pin");
      await this.apps.update(tx.appId, record => {
        if (record.generationBinding.active?.generationId !== tx.pendingGenerationId || record.presetUpdate?.operationId !== tx.operationId) throw new Error("APP_UPDATE_ACTIVE_MISMATCH");
        return { ...record, installedPresetPin: tx.descriptor.sourceCommitSha };
      });
      tx.pinUpdated = true; await this.files.save(tx);
      await this.checkpoint("before-source-sync");
      const sourceRoot = join(this.apps.artifactRoot(tx.appId, tx.pendingGenerationId!), "source");
      await this.files.synchronize(tx, this.require(tx.appId).dir, sourceRoot, this.checkpoint);
      tx.sourceSynced = true; await this.files.save(tx);
      await this.ports.sourceSynchronized?.(tx.appId);
      await this.ports.settleLedger?.(tx.appId, tx.pendingGenerationId!);
      await this.ports.synchronizeRuntime?.(tx.appId);
      tx.ledgerFailed = false; tx.error = undefined;
      await this.setState(tx, "completed");
      await this.clear(tx);
    } catch (error) {
      tx.error = message(error ?? cause); await this.setState(tx, "pending-source-sync");
    }
  }
  private async setState(tx: UpdateTransaction, state: UpdateTransaction["state"]) {
    tx.state = state; await this.files.save(tx);
    await this.apps.update(tx.appId, record => {
      if (record.presetUpdate?.operationId !== tx.operationId) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
      return { ...record, presetUpdate: { operationId: tx.operationId, targetVersion: tx.descriptor.version, state } };
    });
  }
  private async fail(tx: UpdateTransaction, error: unknown) {
    if (this.isCommitted(tx)) { await this.postCommit(tx, error); return; }
    const record = this.apps.get(tx.appId), pendingId = record?.generationBinding.pending?.generationId;
    const replacedStudioGrant = record?.studioGrant?.generationId === tx.pendingGenerationId && Boolean(tx.pendingGenerationId);
    if (pendingId && (!tx.pendingGenerationId || pendingId === tx.pendingGenerationId)) await this.apps.abortPendingGeneration(tx.appId, pendingId);
    await this.apps.update(tx.appId, current => {
      if (!replacedStudioGrant || current.generationBinding.active?.generationId !== tx.originalActiveGenerationId || current.studioGrant) return current;
      return { ...current, studioGrant: tx.previousStudioGrant ?? null, studioGrantRevision: (current.studioGrantRevision ?? 0) + 1 };
    });
    tx.error = message(error); await this.setState(tx, "failed"); await this.clear(tx);
  }
  private async clear(tx: UpdateTransaction) {
    await this.apps.update(tx.appId, record => {
      if (record.presetUpdate?.operationId !== tx.operationId) throw new Error("APP_UPDATE_INSTANCE_CHANGED");
      return { ...record, presetUpdate: undefined };
    });
    this.transactions.delete(tx.appId);
    await this.files.cleanup(tx).catch(error => console.warn("[apps] Update cleanup deferred", error));
  }
}
