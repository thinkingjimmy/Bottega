/**
 * [INPUT]: Depends on the sole Base Store queue, generation/files/attachment ports and receipt or snapshot transfer evidence.
 * [OUTPUT]: Provides atomic source freezing, complete target generation, exact-owner release and recovery correlation.
 * [POS]: Base Store promotion facade; no network or lifecycle journal writes run inside this queue.
 */
import type { BaseSnapshot } from "../../../../../shared/bases-ipc";
import type { SerialQueue } from "../../../persistence/serial-queue";
import { BaseConflictError, BaseIncarnationError, type StoredBase } from "../../base-store-model";
import { baseSyncEnvelopeSchema, type BaseSyncEnvelope } from "../sync/model";
import { ownerFileStem, type BaseStoreFiles } from "../base-files";
import type { BaseAttachmentStore } from "../attachments";
import { prepareProjectBase } from "./generation";
import { promotedBy, transferBaseEnvelope, confirmedBasePromotionSchema, type ConfirmedBasePromotion } from "./cloud";
import { freezeRemoteBase, transferredRemoteEnvelope, type RemoteBasePromotion } from "./remote";
type Ports = { queue: SerialQueue; states: Map<string, StoredBase>; files: BaseStoreFiles; attachments: BaseAttachmentStore;
  requireState(key: string, id: string): StoredBase; commitSync(key: string, state: StoredBase, envelope: BaseSyncEnvelope): Promise<unknown>;
  remove(key: string, id?: string): Promise<boolean> };
export class BasePromotionApi {
  constructor(private readonly ports: Ports) {}
  private snapshot(state: StoredBase): BaseSnapshot { return { meta: state.meta, rows: state.rows }; }
  preparePromotion(
    chatId: string,
    projectId: string,
    intentId: string,
    cloud?: ConfirmedBasePromotion
  ): Promise<BaseSnapshot> {
    return this.ports.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const existing = this.ports.states.get(toKey);
      if (existing) {
        if (!promotedBy(existing, intentId)) {
          throw new BaseConflictError("Project 已有 Base");
        }
        if (cloud && existing.sync.ownershipTransfer?.payloadHash !== confirmedBasePromotionSchema.parse(cloud).operation.payloadHash) throw new BaseConflictError("Base promotion proof changed");
        return this.snapshot(existing);
      }
      let source = this.ports.requireState(
        fromKey,
        this.ports.states.get(fromKey)?.meta.ownerInstanceId ?? ""
      );
      if (cloud) {
        transferBaseEnvelope(source, fromKey, projectId, intentId, cloud);
        if (!source.sync.promotionExport) {
          const envelope = baseSyncEnvelopeSchema.parse({ ...source.sync,
            promotionExport: { intentId, projectId, payloadHash: cloud.operation.payloadHash } });
          await this.ports.commitSync(fromKey, source, envelope);
          source = this.ports.requireState(fromKey, source.meta.ownerInstanceId);
        }
      }
      const state = await prepareProjectBase({
        source,
        fromKey,
        toKey,
        projectId,
        intentId,
        cloud,
        files: this.ports.files,
        attachments: this.ports.attachments,
        writeMeta: (ownerKey, content) =>
          this.ports.files.atomicWrite(this.ports.files.metaPath(ownerKey), content),
      });
      this.ports.states.set(toKey, state);
      return this.snapshot(state);
    });
  }
  finalizePromotion(
    chatId: string,
    projectId: string,
    intentId: string
  ): Promise<BaseSnapshot> {
    return this.ports.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`;
      const toKey = `project:${projectId}`;
      const target = this.ports.states.get(toKey);
      if (!target || !promotedBy(target, intentId)) throw new BaseConflictError("Base promotion target changed");
      const source = this.ports.states.get(fromKey);
      const transfer = target.sync.ownershipTransfer ?? target.sync.remoteOwnershipTransfer;
      if (transfer && (transfer.fromOwnerKey !== fromKey ||
          source && source.meta.ownerInstanceId !== target.meta.ownerInstanceId)) throw new BaseConflictError("Base promotion source changed");
      await this.ports.remove(fromKey, source?.meta.ownerInstanceId ?? (transfer ? target.meta.ownerInstanceId : undefined));
      return this.snapshot(target);
    });
  }

  rollbackPromotion(projectId: string, intentId: string) {
    return this.ports.queue.enqueue(async () => {
      const ownerKey = `project:${projectId}`;
      const state = this.ports.states.get(ownerKey);
      if (state?.sync.ownershipTransfer || state?.sync.remoteOwnershipTransfer) throw new BaseConflictError("Confirmed Base promotion cannot roll back");
      if (state && state.meta.ownerInstanceId !== intentId) {
        throw new BaseIncarnationError("待回滚 Project Base 生命周期已变化");
      }
      await this.ports.files.removeFamilyFiles(ownerKey);
      await this.ports.attachments.releaseFamily(
        ownerFileStem(ownerKey),
        intentId,
        "deleted-proven"
      );
      this.ports.states.delete(ownerKey);
      return Boolean(state);
    });
  }

  promotedSnapshot(projectId: string, intentId: string) {
    const state = this.ports.states.get(`project:${projectId}`);
    return state && promotedBy(state, intentId) ? this.snapshot(state) : null;
  }

  prepareRemotePromotion(chatId: string, projectId: string, intentId: string, input?: RemoteBasePromotion) {
    return this.ports.queue.enqueue(async () => {
      const fromKey = `chat:${chatId}`, toKey = `project:${projectId}`, target = this.ports.states.get(toKey);
      if (target) {
        if (!promotedBy(target, intentId) || !target.sync.remoteOwnershipTransfer) throw new BaseConflictError("Remote Base destination changed");
        return this.snapshot(target);
      }
      let source = this.ports.requireState(fromKey, this.ports.states.get(fromKey)?.meta.ownerInstanceId ?? "");
      if (!source.sync.remoteOwnershipTransfer) {
        if (!input) throw new Error("REMOTE_BASE_SNAPSHOT_REQUIRED");
        const envelope = freezeRemoteBase(source, fromKey, projectId, intentId, input);
        await this.ports.commitSync(fromKey, source, envelope);
        source = this.ports.requireState(fromKey, source.meta.ownerInstanceId);
      }
      transferredRemoteEnvelope(source, fromKey, projectId, intentId);
      const state = await prepareProjectBase({ source, fromKey, toKey, projectId, intentId, remote: true,
        files: this.ports.files, attachments: this.ports.attachments,
        writeMeta: (key, content) => this.ports.files.atomicWrite(this.ports.files.metaPath(key), content) });
      this.ports.states.set(toKey, state); return this.snapshot(state);
    });
  }
}
