/**
 * [INPUT]: Depends on AppStore source baselines and custody, original fixed-ID receipts, Base identity and verified private-file transport; request-bound single-record decoders.
 * [OUTPUT]: Publishes real source changes against their original acknowledged revision; unchanged or stale replicas cannot replace newer packages.
 * [POS]: Main App producer; installation and local grants remain separate from portable publication.
 */
import { join } from "node:path";
import { canonicalJson, hashCanonical, protocolHeader, type CloudBuildConfig, type FileProgress } from "@ai-chat/cloud-protocol";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { AppPublication } from "../../../apps/store/portable/publication-model";
import type { CleanupOwners } from "../account/cleanup/plan";
import type { AccountTransport } from "../../runtime/transport";
import { exportCapturedAppSource, exportPublishedAppSource, releaseCompletedAppSource } from "../../../apps/share/package/cloud-source";
import { memoryBlobSource } from "../chats/bodies";
import { appDescriptor } from "./descriptor";
import { enrollCreatedAppBase } from "./enrollment";
import { baseMetaSchema } from "@ai-chat/base-ui/model/bases-schema";
import { prepareEncryptedBaseInitial } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { openProjectHeadForRequest } from "@ai-chat/cloud-protocol/projects/encrypted/client";
import { openAppHeadForRequest, openAppPackageForRequest, openAppReceipt, prepareAppOperation, type AppCipherPort } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { appCiphertextJournal } from "../../../apps/share/package/custody/ciphertext";

export class DesktopAppPublisher {
  private readonly controller = new AbortController();
  private readonly flights = new Set<Promise<unknown>>();
  private readonly header;
  private readonly crypto: AppCipherPort;
  constructor(private readonly input: { owners: Pick<CleanupOwners, "apps" | "projects" | "bases">; scope: SyncScope; config: CloudBuildConfig; userData: string;
    manifestId: string; transport: Pick<AccountTransport, "query" | "mutate">; files: Pick<EncryptedBlobTransfer, "uploadFile">; crypto(): AppCipherPort; progress?(): (value: FileProgress) => void }) {
    this.crypto = input.crypto();
    if (this.crypto.session.userId !== input.scope.userId) throw new Error("APP_ACCOUNT_CHANGED");
    this.header = { ...protocolHeader(input.config), expectedUserId: input.scope.userId,
      encryptedSpace: { scope: this.crypto.scope, keyPackageFingerprint: this.crypto.keyPackageFingerprint } };
  }
  private track<T>(work: () => Promise<T>) { const flight = work(); this.flights.add(flight);
    void flight.finally(() => this.flights.delete(flight)).catch(() => {}); return flight; }
  createIdentity(appId: string) { return this.track(() => this.create(appId)); }
  private async create(appId: string) {
    const { owners, scope, transport, manifestId } = this.input, signal = this.controller.signal, outbox = owners.apps.portable.publication;
    signal.throwIfAborted();
    let plan = outbox.get(scope, appId);
    if (!plan) {
      const app = owners.apps.get(appId), project = owners.projects.list().find(item => item.workspaceBinding.kind === "app" && item.workspaceBinding.appId === appId);
      const base = project && owners.bases.get(`project:${project.id}`);
      if (!app || app.manifest?.kind !== "base" || !project || !base) throw new Error("APP_ASSOCIATION_UNAVAILABLE");
      signal.throwIfAborted();
      const entry = owners.apps.portable.get(appId);
      let association: AppPublication["association"];
      if (entry?.scope) {
        if (entry.tombstoned || !sameScope(entry.scope, scope)) throw new Error("APP_ASSOCIATION_CHANGED");
        const current = await this.app(appId); signal.throwIfAborted();
        if (!current || current.projectId !== project.id || current.baseId !== base.meta.ownerInstanceId) throw new Error("APP_ASSOCIATION_CHANGED");
        association = { scope, appId, projectId: current.projectId, baseId: current.baseId, revision: current.revision };
      }
      const { syncGeneration: _sync, syncHash: _hash, ...meta } = base.meta;
      plan = await outbox.capture({ scope, manifestId, source: null, ...(association ? { association } : {}), operation: { kind: "create", operationId: hashCanonical(["app-create", scope, manifestId, appId]),
        appId, projectId: project.id, baseId: base.meta.ownerInstanceId, displayName: app.displayName,
        metaJson: canonicalJson({ ...meta, revision: 0, rowsGeneration: 0, galleryGeneration: 0, historyGeneration: 0 }) } });
    }
    if (!plan.createReceipt && !plan.promotion && !plan.association) {
      // A plan without frozen ciphertext has never been sent, and `apply` returns the prior receipt for a repeated operation id.
      const attempted = Boolean(plan.encryptedCreate);
      if (!plan.encryptedCreate) {
        const native = baseMetaSchema.parse(JSON.parse(plan.operation.metaJson));
        const initial = await prepareEncryptedBaseInitial(this.crypto, { meta: native, operationId: plan.operation.operationId }); signal.throwIfAborted();
        const local = owners.projects.get(plan.operation.projectId);
        const frozen = await prepareAppOperation(plan.operation, { app: null, project: local ? owners.projects.portable.export(local) : null,
          baseRevision: 0, baseSchemaRevision: 1, initial }, this.crypto, signal);
        await outbox.freezeCiphertext(scope, appId, frozen); plan = outbox.get(scope, appId)!;
      }
      let receipt = attempted ? await transport.query("apps/api:receipt", { ...this.header, appId, operationId: plan.operation.operationId }) : null; signal.throwIfAborted();
      if (!receipt) receipt = await transport.mutate("apps/api:apply", { ...this.header, operation: plan.encryptedCreate!.transport }); signal.throwIfAborted();
      const opened = await openAppReceipt(receipt, plan.encryptedCreate!, this.crypto, signal);
      plan = await outbox.checkpoint(scope, appId, { createReceipt: opened });
    }
    if (plan.createReceipt) { await enrollCreatedAppBase(owners.bases, scope, plan); signal.throwIfAborted(); }
    const current = await this.app(appId); signal.throwIfAborted();
    if (!current || current.projectId !== plan.operation.projectId || current.baseId !== plan.operation.baseId) throw new Error("APP_ASSOCIATION_CHANGED");
    const project = owners.projects.get(current.projectId);
    if (!project || project.sync && !sameScope(project.sync.scope, scope)) throw new Error("APP_PROJECT_IDENTITY_CONFLICT");
    if (!project.sync && plan.createReceipt) {
      const portable = await this.project(current.projectId); signal.throwIfAborted();
      if (!portable) throw new Error("APP_PROJECT_IDENTITY_CONFLICT");
      await owners.projects.portable.acceptAppCreation(scope, plan.operation, plan.createReceipt, portable); signal.throwIfAborted();
    }
    if (!owners.apps.portable.get(appId)?.scope) await outbox.checkpoint(scope, appId, {}, appDescriptor(current, null));
    return plan;
  }
  private async app(appId: string) {
    const value = await this.input.transport.query("apps/api:get", { ...this.header, appId });
    return value && openAppHeadForRequest(value, appId, this.crypto, this.controller.signal);
  }
  private async project(projectId: string) {
    const value = await this.input.transport.query("projects/sync:head", { ...this.header, projectId });
    return value && openProjectHeadForRequest(value, projectId, this.crypto, this.controller.signal);
  }
  private async version(appId: string, packageRevision: number) {
    const value = await this.input.transport.query("apps/packages:get", { ...this.header, appId, packageRevision });
    return value && openAppPackageForRequest(value, appId, packageRevision, this.crypto, this.controller.signal);
  }
  publishPackage(appId: string) { return this.track(async () => {
    const { owners, scope, transport } = this.input, signal = this.controller.signal, outbox = owners.apps.portable.publication;
    let plan = await this.create(appId); signal.throwIfAborted();
    const active = owners.apps.get(appId)?.generationBinding.active;
    if (!plan.source || active && plan.state !== "pending" && active.generationId !== plan.source.generationId) {
      if (!active) return "unavailable";
      const exported = await exportPublishedAppSource(owners.apps, appId, join(this.input.userData, "cloud-source-export"), signal);
      const { appId: _appId, bytes, ...metadata } = exported; signal.throwIfAborted();
      plan = await outbox.source(scope, appId, { ...metadata, bytes: bytes.length });
    }
    if (plan.state === "complete" || plan.state === "blocked") { await releaseCompletedAppSource(owners.apps, scope, appId); return plan.state; }
    if (!plan.source) throw new Error("APP_PUBLISHED_SOURCE_UNAVAILABLE");
    plan = await outbox.packageIdentity(scope, appId);
    const sourceHash = plan.source!.sha256, operationId = plan.packageOperationId!, fileKey = hashCanonical(["app-file", operationId]);
    const journal = appCiphertextJournal(this.input.userData, scope, appId, sourceHash, work => outbox.withFrozenSource(scope, appId, sourceHash, work));
    let receipt = plan.encryptedCandidate ? await transport.query("apps/api:receipt", { ...this.header, appId, operationId }) : null;
    signal.throwIfAborted();
    if (!receipt && !plan.candidate) {
      const current = await this.app(appId); signal.throwIfAborted();
      if (!current || !plan.baseline) throw new Error("APP_PUBLICATION_BASELINE_UNAVAILABLE");
      if (current.revision !== plan.baseline.revision) return (await outbox.conflict(scope, appId, sourceHash, current.revision)).state;
    }
    if (!receipt) {
      if (!plan.packageBlob) {
        const source = await exportCapturedAppSource(owners.apps, scope, appId, join(this.input.userData, "cloud-source-export"), signal);
        if (source.sha256 !== sourceHash || source.bytes.length !== plan.source!.bytes) throw new Error("APP_PUBLISHED_SOURCE_CHANGED");
        const bytes = memoryBlobSource(new Uint8Array(source.bytes), "application/json");
        const descriptor = await prepareEncryptedFile({ key: fileKey, operationId, owner: { kind: "app", id: appId }, ownerGeneration: plan.source!.generationId,
          source: { sha256: sourceHash, bytes: source.bytes.byteLength, mime: "application/json" }, priority: "background" }, bytes, this.crypto, journal, signal);
        plan = await outbox.checkpoint(scope, appId, { packageBlob: descriptor });
      }
      const attempt = await outbox.attempt(scope, appId);
      await this.input.files.uploadFile(this.header, hashCanonical(["app-upload", scope, operationId, attempt]), "app-package", plan.packageBlob!, journal, fileKey, this.input.progress?.(), signal);
      signal.throwIfAborted();
    }
    if (!plan.candidate) {
      const base = await transport.query("bases/pages:head", { ...this.header, baseId: plan.operation.baseId }); signal.throwIfAborted();
      if (!plan.baseline) throw new Error("APP_PUBLICATION_BASELINE_UNAVAILABLE");
      plan = await outbox.checkpoint(scope, appId, { candidate: { operationId, appId, expectedRevision: plan.baseline.revision,
        packageRevision: plan.baseline.packageRevision + 1, baseSchemaRevision: base.schemaRevision, packageBlob: plan.packageBlob! } });
    }
    if (!plan.encryptedCandidate) {
      const app = await this.app(appId), project = await this.project(plan.operation.projectId);
      if (!app || !project || app.revision !== plan.baseline!.revision) {
        if (app && app.revision > plan.baseline!.revision) return (await outbox.conflict(scope, appId, sourceHash, app.revision)).state;
        throw new Error("APP_PUBLICATION_BASELINE_UNAVAILABLE");
      }
      const base = await transport.query("bases/pages:head", { ...this.header, baseId: plan.operation.baseId });
      const activePackage = app.activePackageRevision ? await this.version(appId, app.activePackageRevision) : null;
      const { generationId: _generation, bytes: _bytes, sha256: _sha, ...verified } = plan.source!;
      const frozen = await prepareAppOperation(plan.candidate!, { app, project, baseRevision: base.cloudRevision, baseSchemaRevision: base.schemaRevision, verified,
        migration: !activePackage ? "initial" : activePackage.migrationDigest === verified.migrationDigest ? "unchanged" : "requires-atomic" }, this.crypto, signal);
      await outbox.freezeCiphertext(scope, appId, frozen); plan = outbox.get(scope, appId)!;
    }
    const request = { ...this.header, appId, operationId };
    if (!receipt) receipt = await transport.query("apps/api:receipt", request); signal.throwIfAborted();
    if (!receipt) {
      let candidate = await transport.query("apps/packages:candidate", request);
      if (!candidate) candidate = await transport.mutate("apps/packages:stage", { ...this.header, candidate: plan.encryptedCandidate!.transport });
      if (candidate.state !== "ready" || candidate.transport.ciphertextHash !== plan.encryptedCandidate!.transport.ciphertextHash) throw new Error("APP_CANDIDATE_CHANGED");
      signal.throwIfAborted(); receipt = await transport.mutate("apps/packages:activate", request);
    }
    const opened = await openAppReceipt(receipt, plan.encryptedCandidate!, this.crypto, signal), app = await this.app(appId);
    if (!app) throw new Error("APP_ASSOCIATION_UNAVAILABLE");
    const version = app.activePackageRevision ? await this.version(appId, app.activePackageRevision) : null;
    signal.throwIfAborted(); plan = await outbox.checkpoint(scope, appId, { publishReceipt: opened }, appDescriptor(app, version));
    await releaseCompletedAppSource(owners.apps, scope, appId); return plan.state;
  }); }
  async close() { this.controller.abort(new Error("APP_UPLOAD_CLOSED")); await Promise.allSettled([...this.flights]); }
}
