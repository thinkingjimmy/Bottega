/**
 * [INPUT]: Depends on authenticated App/Base catalogs, complete paged snapshots and the existing owner Store admission APIs; request-bound single-record decoders.
 * [OUTPUT]: Discovers App identities without re-fetching unchanged packages, mounts/transfers remote Bases, reconciles unwatched Bases whose cloud revision moved and preserves unpublished identity collisions in independent recovery Projects.
 * [POS]: Desktop metadata downlink; per-App and per-Base failures remain visible without blocking unrelated owners, and local contents survive canonical adoption.
 */
import { canonicalJson, hashBytes, protocolHeader, type CloudFunctionResult } from "@ai-chat/cloud-protocol";
import { createEncryptedBaseReader } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { openAppHead, openAppPackageForRequest } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import type { BaseStore } from "../../../bases/base-store";
import type { AppStore } from "../../../apps/store/app-store";
import { PortableAppAdmission } from "../../../apps/store/portable/admission";
import { appDescriptor } from "../apps/descriptor";
import type { CatalogPorts } from "./catalogs";
import { recoverInitialBaseIdentity } from "../bases/identity";
export type WorkspacePorts = CatalogPorts & { apps: AppStore; bases: BaseStore };
export async function pullWorkspace(ports: WorkspacePorts) {
  const { apps, bases, projects, transport, scope } = ports;
  if (!projects) throw new Error("PROJECT_STORE_UNAVAILABLE");
  const crypto = ports.crypto(), signal = new AbortController().signal;
  const header = { ...protocolHeader(ports.config), expectedUserId: scope.userId,
    encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
  const reader = (ownerKey: string, baseId: string, priorOwnerKey = ownerKey) => createEncryptedBaseReader({ transport, crypto: ports.crypto,
    files: ports.baseFiles?.codec({ ownerKey, baseId }),
    pair: id => bases.sync.read(priorOwnerKey, baseId).pendingOperations.find(operation => operation.operationId === id)?.encryptedTransport }, header, baseId);
  const admission = new PortableAppAdmission(apps, projects, bases);
  let cursor: string | null = null, count = 0;
  do {
    ports.current(); const page: CloudFunctionResult<"apps/api:list"> = await transport.query("apps/api:list", { ...header, cursor }); ports.current();
    for (const encrypted of page.items) {
      try {
      const app = await openAppHead(encrypted, crypto, signal); ports.current();
      const previous = apps.portable.get(app.appId);
      // The stored descriptor already pins both revisions, so an unchanged App costs neither a package fetch nor a decrypt.
      if (previous && previous.descriptor.cloudRevision === app.revision && previous.descriptor.packageRevision === app.activePackageRevision) continue;
      const packageWire = app.activePackageRevision === null ? null : await transport.query("apps/packages:get", {
        ...header, appId: app.appId, packageRevision: app.activePackageRevision });
      ports.current();
      const packageValue = packageWire && await openAppPackageForRequest(packageWire, app.appId, app.activePackageRevision!, crypto, signal); ports.current();
      if (app.activePackageRevision !== null && !packageValue) throw new Error("APP_PACKAGE_UNAVAILABLE");
      const descriptor = appDescriptor(app, packageValue);
      if (!previous || canonicalJson(previous.descriptor) !== canonicalJson(descriptor)) {
        const operationId = hashBytes(new TextEncoder().encode(canonicalJson([scope, descriptor])));
        await admission.accept(scope, operationId, descriptor); ports.current(); ports.changed();
      }
      } catch (error) { ports.current(); if (!ports.failure) throw error; ports.failure(error); }
    }
    count += page.items.length; if (count > 10000) throw new Error("APP_CATALOG_BUDGET");
    if (!page.complete && (!page.cursor || page.cursor === cursor)) throw new Error("APP_CATALOG_CURSOR_INVALID"); cursor = page.cursor;
  } while (cursor !== null);
  const localById = new Map<string, ReturnType<BaseStore["listAll"]>>();
  for (const entry of bases.listAll()) {
    const entries = localById.get(entry.snapshot.meta.ownerInstanceId) ?? [];
    entries.push(entry); localById.set(entry.snapshot.meta.ownerInstanceId, entries);
  }
  let afterId: string | null = null; count = 0;
  do {
    ports.current(); const page: CloudFunctionResult<"bases/catalog/api:syncPage"> = await transport.query("bases/catalog/api:syncPage", { ...header, afterId }); ports.current();
    for (const item of page.items) {
      try {
      const ownerKey = item.owner.kind === "chat" ? `chat:${item.owner.chatId}` : `project:${item.owner.projectId}`;
      if (bases.incomplete(ownerKey)) {
        const original = await bases.incompleteEnvelope(ownerKey); ports.current();
        if (!original || original.scope && canonicalJson(original.scope) !== canonicalJson(scope)) throw new Error("BASE_FOLDER_REPAIR_UNAVAILABLE");
        const operations = original.pendingOperations.filter(operation => operation.sealed);
        if (operations.length > 64) throw new Error("BASE_RECEIPT_QUERY_LIMIT");
        const { baseId, receipts, tombstones, ...confirmed } = await createEncryptedBaseReader({ transport, crypto: ports.crypto,
          files: ports.baseFiles?.codec({ ownerKey, baseId: item.baseId }), pair: id => operations.find(operation => operation.operationId === id)?.encryptedTransport }, header, item.baseId).read(operations.map(operation => operation.operationId));
        ports.current(); if (baseId !== item.baseId) throw new Error("BASE_IDENTITY_CONFLICT");
        await bases.repairIncomplete(ownerKey, { scope, confirmed, receipts, tombstones }, ports.current);
        await ports.baseFiles?.admit({ ownerKey, baseId }); ports.current(); ports.changed(); continue;
      }
      const priorOwner = localById.get(item.baseId)?.find(entry => entry.ownerKey !== ownerKey);
      if (priorOwner) {
        const state = bases.sync.read(priorOwner.ownerKey, item.baseId);
        if (state.promotionExport && !state.remoteOwnershipTransfer) continue;
        if (!ports.promotion || priorOwner.snapshot.meta.owner.kind !== "chat" || item.owner.kind !== "project") throw new Error("BASE_OWNER_TRANSFER_UNAVAILABLE");
        if (!projects.get(item.owner.projectId)) throw new Error("BASE_OWNER_UNAVAILABLE");
        const operationIds = state.pendingOperations.filter(operation => operation.sealed).map(operation => operation.operationId);
        if (operationIds.length > 64) throw new Error("BASE_RECEIPT_QUERY_LIMIT");
        const { baseId, receipts, tombstones, ...confirmed } = await reader(ownerKey, item.baseId, priorOwner.ownerKey).read(operationIds);
        ports.current();
        if (baseId !== item.baseId || canonicalJson(confirmed.meta.owner) !== canonicalJson(item.owner)) throw new Error("BASE_IDENTITY_CONFLICT");
        await ports.promotion.acceptRemote({ chatId: priorOwner.snapshot.meta.owner.chatId, projectId: item.owner.projectId, baseId,
          snapshot: { scope, confirmed, receipts, tombstones, expectedLocalRevision: priorOwner.snapshot.meta.revision } });
        ports.current(); await ports.baseFiles?.admit({ ownerKey, baseId: item.baseId }); ports.current(); ports.changed(); continue;
      }
      const existing = bases.get(ownerKey);
      if (existing && existing.meta.ownerInstanceId !== item.baseId) {
        const { baseId, receipts: _receipts, tombstones, ...confirmed } = await reader(ownerKey, item.baseId).read([]);
        ports.current();
        if (baseId !== item.baseId || canonicalJson(confirmed.meta.owner) !== canonicalJson(item.owner)) throw new Error("BASE_IDENTITY_CONFLICT");
        await recoverInitialBaseIdentity({ store: bases, projects, scope, ownerKey, baseId: existing.meta.ownerInstanceId,
          confirmed, tombstones, current: () => ports.current() });
        await ports.baseFiles?.admit({ ownerKey, baseId: item.baseId }); ports.current(); ports.changed(); continue;
      }
      const envelope = existing && bases.sync.read(ownerKey, item.baseId);
      // Publication owns its receipt-backed baseline even while a lost create reply is being replayed.
      const originalCreation = apps.portable.publication.list(scope).some(plan => plan.operation.baseId === item.baseId &&
        !plan.association && !plan.promotion && Boolean(plan.encryptedCreate));
      if (existing && !envelope?.scope && originalCreation) continue;
      if (envelope?.scope) {
        if (envelope.scope.environment !== scope.environment || envelope.scope.userId !== scope.userId) throw new Error("BASE_SYNC_SCOPE_CONFLICT");
        if ((envelope.confirmed?.cloudRevision ?? 0) < item.cloudRevision) ports.refreshBase?.({ ownerKey, baseId: item.baseId });
        continue;
      }
      if (existing && (existing.meta.revision || existing.rows.length || existing.meta.historyGeneration || existing.meta.galleryGeneration)) {
        const { receipts: _receipts, baseId: _id, tombstones, ...confirmed } = await reader(ownerKey, item.baseId).read([]);
        ports.current();
        await recoverInitialBaseIdentity({ store: bases, projects, scope, ownerKey, baseId: item.baseId, confirmed, tombstones, current: ports.current });
        await ports.baseFiles?.admit({ ownerKey, baseId: item.baseId }); ports.current(); ports.changed(); continue;
      }
      if (item.owner.kind === "chat") {
        const local = await ports.chats.read(scope, { type: "chat-metadata", chatId: item.owner.chatId }); ports.current();
        if (local.type !== "chat-metadata" || local.value.head?.chat.incarnationId !== item.owner.incarnationId) throw new Error("BASE_OWNER_UNAVAILABLE");
      } else if (!projects.get(item.owner.projectId)) throw new Error("BASE_OWNER_UNAVAILABLE");
      const { baseId, receipts: _receipts, tombstones, ...confirmed } = await reader(ownerKey, item.baseId).read([]);
      ports.current();
      if (baseId !== item.baseId || canonicalJson(confirmed.meta.owner) !== canonicalJson(item.owner)) throw new Error("BASE_IDENTITY_CONFLICT");
      const local = await bases.ensure({ owner: confirmed.meta.owner, ownerInstanceId: baseId, title: confirmed.meta.name, navigation: confirmed.meta.navigation });
      ports.current();
      await bases.sync.installMirror(ownerKey, baseId, scope, confirmed, local.meta.revision);
      ports.current();
      if (tombstones.length) await bases.sync.reconcile(ownerKey, baseId, scope, confirmed, [], tombstones, String(confirmed.cloudRevision));
      ports.current(); await ports.baseFiles?.admit({ ownerKey, baseId }); ports.current(); ports.changed();
      } catch (error) { ports.current(); if (!ports.failure) throw error; ports.failure(error); }
    }
    count += page.items.length; if (count > 10000) throw new Error("BASE_CATALOG_BUDGET");
    if (!page.complete && (!page.cursor || page.cursor === afterId)) throw new Error("BASE_CATALOG_CURSOR_INVALID"); afterId = page.cursor;
  } while (afterId !== null);
}
