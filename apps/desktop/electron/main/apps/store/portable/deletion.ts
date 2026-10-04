/**
 * [INPUT]: Depends on the AppStore writer, exact account scope and original deletion operations/receipts.
 * [OUTPUT]: Persists deletion intent before delivery, freezes retries and retains explicit conflict decisions.
 * [POS]: AppStore deletion collaborator; all mutations commit with the existing portable catalog.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import type { AppReceipt } from "@ai-chat/cloud-protocol/apps/model";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { appPortableCatalogSchema } from "./model";
import { appDeletionRequestSchema, type AppDeletionRequest } from "./deletion-model";
import type { AppPortablePorts } from "./api";
import type { FrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted";
import { verifyFrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted/client";
export class AppDeletionApi {
  constructor(private ports: AppPortablePorts, private assertScope: (scope: SyncScope) => void) {}
  list(scope?: SyncScope) { return structuredClone(this.ports.state().deletions.filter(item => !scope || sameScope(item.scope, scope))); }
  get(scope: SyncScope, operationId: string) {
    this.assertScope(scope); return this.list(scope).find(item => item.operation.operationId === operationId) ?? null;
  }
  capture(input: Pick<AppDeletionRequest, "operation" | "projectId" | "baseId" | "baseline"> & { scope: SyncScope }) {
    return this.ports.enqueue(async () => {
      this.assertScope(input.scope);
      const request = appDeletionRequestSchema.parse({ ...input, attempts: 0, receipt: null, dismissed: false });
      const state = this.ports.state(), previous = state.deletions.find(item => item.operation.operationId === request.operation.operationId);
      if (previous) {
        if (!sameScope(previous.scope, request.scope) || previous.projectId !== request.projectId || previous.baseId !== request.baseId ||
          canonicalJson(previous.operation) !== canonicalJson(request.operation)) throw new Error("APP_DELETION_REQUEST_CHANGED");
        return structuredClone(previous);
      }
      const entry = state.entries.find(item => item.descriptor.appId === request.operation.appId);
      if (!entry || !sameScope(entry.scope, request.scope) || entry.tombstoned || entry.descriptor.projectId !== request.projectId ||
        entry.descriptor.baseId !== request.baseId || entry.descriptor.cloudRevision > request.operation.expectedRevision) throw new Error("APP_DELETION_REVIEW_CHANGED");
      if (state.deletions.some(item => sameScope(item.scope, request.scope) && item.operation.appId === request.operation.appId && !item.receipt)) throw new Error("APP_DELETION_PENDING");
      await this.ports.commit(appPortableCatalogSchema.parse({ ...state, deletions: [...state.deletions, request] }));
      return structuredClone(request);
    });
  }
  attempt(scope: SyncScope, operationId: string) { return this.update(scope, operationId, request => {
    if (!request.receipt) request.attempts++;
  }); }
  freezeCiphertext(scope: SyncScope, operationId: string, input: FrozenAppOperation) {
    return this.update(scope, operationId, request => {
      const value = verifyFrozenAppOperation(input, request.operation);
      if (request.encryption) {
        if (request.encryption.plaintextHash !== value.plaintextHash || canonicalJson(request.encryption.encryptedSpace) !== canonicalJson(value.encryptedSpace)) throw new Error("APP_DELETION_CIPHERTEXT_CHANGED");
      } else {
        if (request.attempts || request.receipt) throw new Error("APP_DELETION_CIPHERTEXT_CHANGED");
        request.encryption = value;
      }
    });
  }
  receive(scope: SyncScope, operationId: string, receipt: AppReceipt) { return this.update(scope, operationId, request => {
    if (request.receipt && canonicalJson(request.receipt) !== canonicalJson(receipt)) throw new Error("APP_DELETION_RECEIPT_CHANGED");
    request.receipt = receipt;
  }); }
  dismiss(scope: SyncScope, operationId: string) { return this.update(scope, operationId, request => { request.dismissed = true; }); }
  private update(scope: SyncScope, operationId: string, change: (request: AppDeletionRequest) => void) {
    return this.ports.enqueue(async () => {
      this.assertScope(scope); const state = structuredClone(this.ports.state());
      const request = state.deletions.find(item => sameScope(item.scope, scope) && item.operation.operationId === operationId);
      if (!request) throw new Error("APP_DELETION_REQUEST_UNAVAILABLE");
      change(request); const parsed = appDeletionRequestSchema.parse(request);
      await this.ports.commit(appPortableCatalogSchema.parse(state)); return parsed;
    });
  }
}
