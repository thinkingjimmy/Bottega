/**
 * [INPUT]: Bounded discovery, original Base/operation/resolution-bound reads and the account-scoped BaseStore writer.
 * [OUTPUT]: Discovers remote candidates and refreshes known dispositions with a revision fence and resumable bounded passes.
 * [POS]: Desktop Base downlink collaborator; page cursors are read caches and never replace durable candidate truth.
 */
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { openEncryptedBaseLookup, type BaseCipherPort, type BaseCipherFiles } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { BaseStore } from "../../../bases/base-store";
import type { AccountTransport } from "../../runtime/transport";
type Target = { ownerKey: string; baseId: string };
type Pass = { revision: number; cursor: string | null; complete: boolean; checked: Set<string> };
export class DesktopBaseCandidates {
  private passes = new Map<string, Pass>();
  private readonly header;
  constructor(private ports: { store: BaseStore; transport: Pick<AccountTransport, "query">; config: CloudBuildConfig; scope: SyncScope;
    crypto(): BaseCipherPort; files?: { codec(target: Target): BaseCipherFiles; admit(target: Target, replace?: boolean): Promise<void> }; changed(target: Target): void }) {
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId };
  }
  clear(baseId?: string) { if (baseId) this.passes.delete(baseId); else this.passes.clear(); }
  async pull(target: Target, current: () => boolean) {
    const crypto = this.ports.crypto(), args = { ...this.header, baseId: target.baseId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const revision = await this.ports.transport.query("bases/conflicts:head", args); if (!current()) return false;
    let pass = this.passes.get(target.baseId);
    if (!pass || pass.revision !== revision) {
      pass = { revision, cursor: null, complete: false, checked: new Set() }; this.passes.set(target.baseId, pass);
      const changed = await this.ports.store.sync.candidateDiscovery(target.ownerKey, target.baseId, this.ports.scope, revision, false); if (!current()) return false;
      if (changed) this.ports.changed(target);
    }
    const refresh = async (operationId: string, listed = false) => {
      if (pass!.checked.has(operationId)) return true;
      const state = this.ports.store.sync.read(target.ownerKey, target.baseId);
      const resolutionOperationId = state.conflictCandidates.find(item => item.operation.operationId === operationId)?.resolutionOperationId ?? null;
      const raw = await this.ports.transport.query("bases/conflicts:operation", { ...args, operationId, resolutionOperationId }); if (!current()) return false;
      if (!raw) throw new Error("BASE_REMOTE_CANDIDATE_UNAVAILABLE");
      const proof = await openEncryptedBaseLookup(crypto, { baseId: target.baseId, operationId, resolutionOperationId }, raw,
        this.ports.files?.codec(target)); if (!current()) return false;
      if (proof.receipt.operationId !== operationId || (proof.operation ? proof.operation.baseId !== target.baseId : listed)) throw new Error("BASE_REMOTE_CANDIDATE_INVALID");
      const latest = this.ports.store.sync.read(target.ownerKey, target.baseId);
      if (proof.receipt.cloudRevision > (latest.confirmed?.cloudRevision ?? 0) || proof.resolutionReceipt && latest.pendingOperations.some(item => item.operationId === proof.resolutionReceipt!.operationId)) return false;
      const changed = await this.ports.store.sync.receiveCandidate(target.ownerKey, target.baseId, this.ports.scope, proof, resolutionOperationId);
      if (current()) await this.ports.files?.admit(target, false);
      if (!current()) return false;
      pass!.checked.add(operationId); if (changed) this.ports.changed(target); return true;
    };
    if (!pass.complete) {
      const page = await this.ports.transport.query("bases/conflicts:list", { ...args, cursor: pass.cursor }); if (!current()) return false;
      for (const operationId of new Set(page.items.map(value => value.commit.operationId))) {
        if (!await refresh(operationId, true)) return current();
      }
      if (!page.complete && (!page.cursor || page.cursor === pass.cursor)) throw new Error("BASE_CANDIDATE_PAGE_INCOMPLETE");
      pass.cursor = page.cursor; pass.complete = page.complete;
    }
    const known = this.ports.store.sync.read(target.ownerKey, target.baseId).conflictCandidates
      .filter(item => item.receipt && !item.remoteResolved && !pass!.checked.has(item.operation.operationId));
    for (const candidate of known.slice(0, 20)) if (!await refresh(candidate.operation.operationId)) return current();
    const after = await this.ports.transport.query("bases/conflicts:head", args); if (!current()) return false;
    if (after !== revision) { this.passes.delete(target.baseId); return true; }
    const incomplete = !pass.complete || known.length > 20;
    if (!incomplete && await this.ports.store.sync.candidateDiscovery(target.ownerKey, target.baseId, this.ports.scope, revision, true) && current()) this.ports.changed(target);
    return incomplete;
  }
}
