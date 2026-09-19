/**
 * [INPUT]: Depends on the sole ProjectStore writer and current authenticated scoped transport; request-bound single-record decoders.
 * [OUTPUT]: Provides serial metadata upload, immutable receipt recovery and subscription reconciliation.
 * [POS]: Main Project scheduler; pending operations and local workspace authority stay in ProjectStore.
 */
import { protocolHeader, type CloudBuildConfig, type CloudFunctionArgs } from "@ai-chat/cloud-protocol";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { AccountTransport } from "../../runtime/transport";
import { openProjectHeadForRequest, openProjectReceipt, prepareProjectOperation, type ProjectCipherPort } from "@ai-chat/cloud-protocol/projects/encrypted/client";
type Transport = Pick<AccountTransport, "query" | "mutate"> & {
  watchProject?(input: CloudFunctionArgs<"projects/sync:head">, changed: () => void, failed: (error: unknown) => void): () => void;
};
type Ports = { store: ProjectStore; config: CloudBuildConfig; scope: SyncScope; transport: Transport;
  crypto(): ProjectCipherPort;
  changed(projectId: string): void; failure(projectId: string, error: unknown): void };
export class DesktopProjectSync {
  private closed = false;
  private generation = 0;
  private readonly flights = new Map<string, Promise<void>>();
  private readonly dirty = new Set<string>();
  private readonly watches = new Map<string, () => void>();
  private readonly header;
  private readonly crypto: ProjectCipherPort;
  private readonly abort = new AbortController();
  constructor(private readonly ports: Ports) {
    if (ports.scope.environment !== ports.config.environmentId) throw new Error("environment-mismatch");
    this.crypto = ports.crypto();
    if (this.crypto.session.userId !== ports.scope.userId) throw new Error("PROJECT_SYNC_SCOPE_UNAVAILABLE");
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId,
      encryptedSpace: { scope: this.crypto.scope, keyPackageFingerprint: this.crypto.keyPackageFingerprint } };
  }
  observe(projectId: string) {
    if (this.closed || this.watches.has(projectId)) return;
    const unsubscribe = this.ports.transport.watchProject?.({ ...this.header, projectId },
      () => { void this.flush(projectId); }, error => { if (!this.closed) this.ports.failure(projectId, error); });
    if (unsubscribe) this.watches.set(projectId, unsubscribe);
    void this.flush(projectId);
  }
  flush(projectId: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.dirty.add(projectId);
    const previous = this.flights.get(projectId); if (previous) return previous;
    const generation = this.generation, current = () => !this.closed && generation === this.generation;
    const flight = (async () => {
      let sent = 0;
      while (current() && this.dirty.delete(projectId)) {
        const sync = this.ports.store.portable.read(this.ports.scope, projectId);
        if (sync.deleted) return;
        const pending = sync.pending.find(item => item.state === "queued" && item.predecessorId === null);
        if (!pending) {
          if (sync.conflicts.some(item => item.operation.command.kind === "create")) return;
          const encryptedHead = await this.ports.transport.query("projects/sync:head", { ...this.header, projectId });
          if (!current()) return;
          if (!encryptedHead) throw new Error("PROJECT_CLOUD_METADATA_UNAVAILABLE");
          const head = await openProjectHeadForRequest(encryptedHead, projectId, this.crypto, this.abort.signal);
          if (!current()) return;
          await this.ports.store.portable.accept(this.ports.scope, "head-" + head.cloudRevision, head);
          if (current()) this.ports.changed(projectId);
          continue;
        }
        if (sent >= 64) { setTimeout(() => { void this.flush(projectId); }, 0).unref(); continue; }
        let frozen = sync.ciphertextBindings.find(item => item.transport.operationId === pending.operation.operationId);
        if (!frozen && !pending.attempts && pending.operation.command.kind === "create" && !sync.confirmed) {
          const existing = await this.ports.transport.query("projects/sync:head", { ...this.header, projectId });
          if (!current()) return;
          if (existing) {
            const head = await openProjectHeadForRequest(existing, projectId, this.crypto, this.abort.signal);
            if (!current()) return;
            await this.ports.store.portable.accept(this.ports.scope, "adopt-" + head.cloudRevision, head);
            if (current()) this.ports.changed(projectId); continue;
          }
        }
        if (!frozen) {
          if (pending.attempts) throw new Error("PROJECT_CIPHERTEXT_REQUIRED");
          const candidate = await prepareProjectOperation(pending.operation, sync.confirmed ?? null, this.crypto, this.abort.signal);
          if (!current()) return;
          frozen = await this.ports.store.portable.freezeCiphertext(this.ports.scope, projectId, candidate);
          if (!current()) return;
        }
        let encryptedReceipt = pending.attempts ? await this.ports.transport.query("projects/sync:receipt", {
          ...this.header, operationId: pending.operation.operationId,
        }) : null;
        if (!current()) return;
        if (!encryptedReceipt) {
          await this.ports.store.portable.seal(this.ports.scope, projectId, pending.operation.operationId, frozen.transport.ciphertextHash);
          if (!current()) return;
          encryptedReceipt = await this.ports.transport.mutate("projects/sync:apply", { ...this.header, operation: frozen.transport });
          if (!current()) return;
        }
        const receipt = await openProjectReceipt(encryptedReceipt, frozen, this.crypto, this.abort.signal);
        if (!current()) return;
        await this.ports.store.portable.confirm(this.ports.scope, receipt, frozen.transport.ciphertextHash);
        if (current()) this.ports.changed(projectId);
        sent++; this.dirty.add(projectId);
      }
    })().catch(error => { if (current()) this.ports.failure(projectId, error); });
    this.flights.set(projectId, flight);
    void flight.finally(() => { if (this.flights.get(projectId) === flight) this.flights.delete(projectId); });
    return flight;
  }
  async close() {
    this.closed = true; this.generation++; this.dirty.clear(); this.abort.abort();
    for (const unsubscribe of this.watches.values()) unsubscribe(); this.watches.clear();
    await Promise.all(this.flights.values());
  }
}
