/**
 * [INPUT]: Depends on actual Chat attachment and Base family byte owners with bounded file hashing.
 * [OUTPUT]: Captures and verifies local byte custody before account cache removal or owner detachment.
 * [POS]: Cleanup proof adapter; shared attachments stay with their original local owners.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { AttachmentStore } from "../../../../chats/attachment-store";
import { ownerFileStem } from "../../../../bases/store/base-files";
import { collectRowAttachmentBlobIds } from "../../../../bases/store/gallery-ledger";
import { syncAttachmentRoots } from "../../../../bases/store/sync/projection";
import type { ScopeCleanupPlan } from "../../../../lifecycle/scope-cleanup/model";
import { localBlobSource } from "../../../files/store";
import type { CleanupOwners } from "./plan";
type BlobProof = ScopeCleanupPlan["retainedBlobs"][number];
export class CleanupBytes {
  private readonly attachments: AttachmentStore;
  constructor(private owners: CleanupOwners) { this.attachments = new AttachmentStore(() => owners.homes.libraryRoot); }
  async capture(plan: ScopeCleanupPlan) {
    const proofs = new Map<string, BlobProof>();
    for (const chat of plan.chats) if (chat.retain) {
      for (const message of await this.owners.chats.getNativeMessages(chat.chatId) ?? []) {
        if (message.role !== "user") continue;
        for (const attachment of message.attachments ?? []) {
          const blob = await this.attachments.logical(attachment.id, chat.chatId);
          const proof = { owner: JSON.stringify(["chat", chat.chatId]), blobId: attachment.id, sha256: blob.sha256 };
          proofs.set(proof.owner + proof.blobId, proof);
        }
      }
    }
    for (const base of plan.bases) if (base.retain) {
      const snapshot = this.owners.bases.get(base.ownerKey, base.ownerInstanceId);
      if (!snapshot) throw new Error("CLEANUP_BASE_UNAVAILABLE");
      const ids = new Set([...collectRowAttachmentBlobIds(snapshot.rows), ...syncAttachmentRoots(this.owners.bases.sync.read(base.ownerKey, base.ownerInstanceId))]);
      for (const blobId of ids) {
        const match = /^att_([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/.exec(blobId);
        if (!match) throw new Error("CLEANUP_BASE_BLOB_INVALID");
        const proof = { owner: JSON.stringify(["base", base.ownerKey, base.ownerInstanceId]), blobId, sha256: match[1]! };
        await this.verify(proof); proofs.set(proof.owner + proof.blobId, proof);
      }
    }
    if (proofs.size > 100000) throw new Error("CLEANUP_BLOB_INVENTORY_LIMIT");
    return [...proofs.values()];
  }
  async verify(proof: BlobProof) {
    const owner: unknown = JSON.parse(proof.owner);
    if (!Array.isArray(owner)) throw new Error("CLEANUP_BLOB_OWNER_INVALID");
    if (owner[0] === "chat" && owner.length === 2) {
      const blob = await this.attachments.logical(proof.blobId, String(owner[1]));
      if (blob.sha256 !== proof.sha256) throw new Error("CLEANUP_BLOB_CHANGED"); return blob;
    }
    if (owner[0] !== "base" || owner.length !== 3 || typeof owner[1] !== "string" || typeof owner[2] !== "string" ||
      !/^(chat|project):[A-Za-z0-9_-]{1,128}$/.test(owner[1]) || !/^[A-Za-z0-9_-]{1,128}$/.test(owner[2]) ||
      !new RegExp(`^att_${proof.sha256}\\.(png|jpe?g|webp|gif)$`).test(proof.blobId)) throw new Error("CLEANUP_BLOB_OWNER_INVALID");
    const file = await localBlobSource(join(this.owners.bases.attachments.familyPath(ownerFileStem(owner[1]), owner[2]), proof.blobId), "application/octet-stream");
    try {
      const digest = createHash("sha256");
      for (let offset = 0; offset < file.source.bytes; offset += 1024 * 1024) digest.update(await file.source.read(offset, Math.min(1024 * 1024, file.source.bytes - offset)));
      if (digest.digest("hex") !== proof.sha256) throw new Error("CLEANUP_BLOB_CHANGED");
      return { ...proof, bytes: file.source.bytes };
    } finally { await file.close(); }
  }
}
