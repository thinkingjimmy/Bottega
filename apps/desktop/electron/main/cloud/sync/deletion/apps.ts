/**
 * [INPUT]: Depends on authorized App deletion disposition, admitted content crypto, original frozen Base receipts and staged file mappings; request-bound single-record decoders.
 * [OUTPUT]: Retires known App installations, adopts retained Base custody or deletion candidates, and advances the original SQLite feed cursor last.
 * [POS]: App deletion downlink; network reads stay outside local lifecycle locks and cannot create runtime authority.
 */
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { createEncryptedBaseReader } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { openAppReceipt, type AppCipherPort } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { openProjectHeadForRequest } from "@ai-chat/cloud-protocol/projects/encrypted/client";
import type { CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { CleanupOwners } from "../account/cleanup/plan";
import type { AccountTransport } from "../../runtime/transport";
import type { ChatSyncStore } from "../chats/sources";
import { enrollCreatedAppBase } from "../apps/enrollment";
import { pullDeletionPage, type DeletionHead } from "./feed";
import type { BaseFilePublisher } from "../bases/files";
import { recoverInitialBaseIdentity } from "../bases/identity";
export type AppRetirement = (scope: SyncScope, proof: CloudAppDeletion, current: () => void) => Promise<void>;
export class DesktopAppDeletions {
  private readonly header;
  constructor(private ports: { scope: SyncScope; config: CloudBuildConfig; store: ChatSyncStore; crypto(): AppCipherPort;
    baseFiles: Pick<BaseFilePublisher, "codec" | "admit">;
    owners: Pick<CleanupOwners, "apps" | "projects" | "bases">; transport: Pick<AccountTransport, "query">;
    retireApp?: AppRetirement; current(): void; changed(): void; forget(baseId: string): void }) {
    const crypto = ports.crypto();
    if (crypto.session.userId !== ports.scope.userId) throw new Error("APP_DELETION_SCOPE_CHANGED");
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  }
  private async proof(marker: CloudTombstone) {
    const proof = await this.ports.transport.query("apps/api:deletion", { ...this.header, appId: marker.entityId }); this.ports.current();
    if (!proof || canonicalJson(proof.tombstone) !== canonicalJson(marker)) throw new Error("APP_DELETION_IDENTITY_CHANGED");
    return proof;
  }
  private async originalCreation(proof: CloudAppDeletion) {
    const { owners, scope, current, transport } = this.ports;
    let plan = owners.apps.portable.publication.get(scope, proof.appId);
    if (!plan || plan.promotion || plan.association) return;
    if (plan.operation.projectId !== proof.projectId || plan.operation.baseId !== proof.baseId) throw new Error("APP_DELETION_IDENTITY_CHANGED");
    if (!plan.createReceipt) {
      const receipt = await transport.query("apps/api:receipt", { ...this.header, appId: proof.appId, operationId: plan.operation.operationId }); current();
      if (!receipt || !plan.encryptedCreate) throw new Error("APP_CREATION_RECEIPT_REQUIRED");
      const opened = await openAppReceipt(receipt, plan.encryptedCreate, this.ports.crypto(), new AbortController().signal); current();
      plan = await owners.apps.portable.publication.checkpoint(scope, proof.appId, { createReceipt: opened }); current();
    }
    const project = owners.projects.get(proof.projectId);
    if (project && !project.sync) {
      const frozen = plan.encryptedCreate?.transport.project;
      if (!frozen?.facts || !plan.encryptedCreate) throw new Error("APP_CREATION_RECEIPT_REQUIRED");
      const opened = await openProjectHeadForRequest({ projectId: frozen.projectId, operationId: frozen.operationId, intent: frozen.intent,
        facts: frozen.facts, encryptedSpace: plan.encryptedCreate.encryptedSpace, revision: 1, createdAt: frozen.intent.createdAt,
        updatedAt: Math.max(frozen.intent.createdAt, plan.createReceipt!.createdAt) }, proof.projectId, this.ports.crypto(), new AbortController().signal); current();
      await owners.projects.portable.acceptAppCreation(scope, plan.operation, plan.createReceipt!, opened); current();
    }
    const base = owners.bases.get(`project:${proof.projectId}`, proof.baseId);
    if (base) { await enrollCreatedAppBase(owners.bases, scope, plan); current(); }
  }
  private async dispose(proof: CloudAppDeletion) {
    const { owners, scope, current, transport, forget } = this.ports, owner = `project:${proof.projectId}`;
    if (proof.retainBase) {
      const projectWire = await transport.query("projects/sync:head", { ...this.header, projectId: proof.projectId }); current();
      const project = projectWire ? await openProjectHeadForRequest(projectWire, proof.projectId, this.ports.crypto(), new AbortController().signal) : null; current();
      if (!project || project.role !== "base-custody") throw new Error("APP_RETAINED_PROJECT_UNAVAILABLE");
      const local = owners.bases.get(owner, proof.baseId), envelope = local && owners.bases.sync.read(owner, proof.baseId);
      if (envelope?.scope && !sameScope(envelope.scope, scope)) throw new Error("APP_RETAINED_BASE_SCOPE_CHANGED");
      const operations = envelope?.pendingOperations.filter(item => item.sealed).map(item => item.operationId) ?? [];
      if (operations.length > 64) throw new Error("BASE_RECEIPT_QUERY_LIMIT");
      const target = { ownerKey: owner, baseId: proof.baseId };
      const { baseId, tombstones, receipts, ...confirmed } = await createEncryptedBaseReader({ transport,
        crypto: this.ports.crypto, files: this.ports.baseFiles.codec(target),
        pair: id => envelope?.pendingOperations.find(item => item.operationId === id)?.encryptedTransport,
      }, this.header, proof.baseId).read(operations); current();
      if (baseId !== proof.baseId || confirmed.meta.owner.kind !== "project" || confirmed.meta.owner.projectId !== proof.projectId ||
        confirmed.meta.navigation.kind !== "root-user-managed" || confirmed.meta.navigation.source !== "retained-app-data") throw new Error("APP_RETAINED_BASE_CHANGED");
      if (!local) {
        const initial = await owners.bases.ensure({ owner: confirmed.meta.owner, ownerInstanceId: baseId, title: confirmed.meta.name, navigation: confirmed.meta.navigation }); current();
        await owners.bases.sync.installMirror(owner, baseId, scope, confirmed, initial.meta.revision); current();
      } else if (!envelope?.scope && envelope?.cloudState === "local-only") {
        await recoverInitialBaseIdentity({ store: owners.bases, projects: owners.projects, scope, ownerKey: owner, baseId, confirmed, tombstones, current }); current();
      }
      await owners.bases.sync.reconcile(owner, baseId, scope, confirmed, receipts, tombstones, String(confirmed.cloudRevision)); current();
      await this.ports.baseFiles.admit(target); current();
      await owners.projects.portable.acceptAppDeletion(scope, proof, project); current();
    } else {
      forget(proof.baseId);
      for (const { ownerKey, snapshot } of owners.bases.listAll()) if (snapshot.meta.ownerInstanceId === proof.baseId &&
        sameScope(owners.bases.sync.read(ownerKey, proof.baseId).scope, scope)) {
        await owners.bases.sync.acceptDeletion(ownerKey, proof.baseId, scope); current();
      }
      if (owners.projects.get(proof.projectId)) { await owners.projects.portable.acceptAppDeletion(scope, proof, null); current(); }
    }
    this.ports.changed();
  }
  async pull(shared?: DeletionHead) {
    await pullDeletionPage(this.ports, "appDeletions", async marker => {
      if (marker.entityKind !== "app") return;
      const { owners, scope, current, retireApp } = this.ports, entry = owners.apps.portable.get(marker.entityId);
      if (entry && !entry.scope && !entry.tombstoned && entry.descriptor.cloudRevision === 0 && !owners.apps.portable.publication.get(scope, marker.entityId)) {
        const proof = await this.proof(marker);
        if (proof.retainBase) await this.dispose(proof);
        else {
          const ownerKey = `project:${proof.projectId}`, local = owners.bases.get(ownerKey, proof.baseId);
          if (local) {
            const envelope = owners.bases.sync.read(ownerKey, proof.baseId);
            if (!envelope.scope && !envelope.tombstones.includes("base")) {
              const plan = owners.bases.sync.initialIdentityPlan(ownerKey, proof.baseId, scope, null);
              await owners.projects.portable.ensureRecoveredBaseProject(scope, { ...plan, localOnly: true }); current();
              await owners.bases.sync.retainDeletedIdentity(ownerKey, proof.baseId, scope, plan.recoveryId); current();
            }
          }
          const project = owners.projects.get(proof.projectId);
          if (project && !project.sync) { await owners.projects.portable.acceptDeletion(scope, proof.projectId); current(); }
        }
        await owners.apps.retainDeletedFolderApp(scope, proof); current();
        if (owners.apps.get(proof.appId)) {
          if (!retireApp) throw new Error("APP_RETIREMENT_UNAVAILABLE");
          await retireApp(scope, proof, current); current();
        }
        this.ports.changed(); return;
      }
      if (entry ? !sameScope(entry.scope, scope) : !owners.apps.portable.publication.get(scope, marker.entityId)) return;
      if (!retireApp) throw new Error("APP_RETIREMENT_UNAVAILABLE");
      let proof = await this.proof(marker);
      await this.originalCreation(proof); current();
      await retireApp(scope, proof, current); current();
      try { await this.dispose(proof); }
      catch (error) {
        const latest = await this.proof(marker);
        if (!proof.retainBase || latest.retainBase) throw error;
        proof = latest; await owners.apps.portable.acceptDeletion(scope, proof); current(); await this.dispose(proof);
      }
      current();
    }, shared);
  }
}
