/**
 * [INPUT]: Depends on shared SurfaceCapsuleV1/SurfaceImageTransfer DTOs and limits, and cloud-protocol sniffImageMime
 * [OUTPUT]: Provides MigrationImageCustody: validates the image bytes a source window exports beside its capsule, holds the accepted ones in memory
 *           for one transaction, forwards them to the target's hydrate, and drops them on commit, restore or the transaction deadline
 * [POS]: Window surfaces core side channel for F-34(b); the capsule stays plain bounded data, and bytes never touch disk
 */

import { sniffImageMime } from "@ai-chat/cloud-protocol/artifacts/media-types";
import {
  SURFACE_IMAGE_TRANSFER_LIMITS as LIMITS,
  type SurfaceCapsuleV1,
  type SurfaceComposerImage,
  type SurfaceImageTransfer,
} from "../../../../../shared/ipc/settings/window-surfaces-ipc";

type Timers = Readonly<{
  deadlineMs: number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}>;

const defaultTimers: Timers = {
  deadlineMs: 60_000,
  setTimer: (run, ms) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer; },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const mismatch = () => new Error("IMAGE_TRANSFER_MISMATCH");

function declaredImages(capsule: SurfaceCapsuleV1 | undefined) {
  const composer = capsule?.composer;
  const declared = new Map<string, SurfaceComposerImage>();
  for (const item of [...(composer?.draftImages ?? []), ...(composer?.queue ?? []).flatMap(entry => entry.images ?? [])]) {
    if (!LIMITS.transferId.test(item.transferId) || declared.has(item.transferId)) throw mismatch();
    declared.set(item.transferId, item);
  }
  return declared;
}

export class MigrationImageCustody {
  private readonly held = new Map<string, { images: SurfaceImageTransfer[]; timer: unknown }>();

  constructor(private readonly timers: Timers = defaultTimers) {}

  /** Structural mismatches refuse the move; an image that fails its own check is withheld and arrives unavailable. */
  hold(transactionId: string, capsule: SurfaceCapsuleV1 | undefined, raw: unknown) {
    const declared = declaredImages(capsule);
    if (raw === undefined && declared.size === 0) return;
    if (!Array.isArray(raw) || raw.length !== declared.size) throw mismatch();
    if (raw.length > LIMITS.count) throw new Error("IMAGE_TRANSFER_LIMIT");
    const seen = new Set<string>();
    let total = 0;
    const accepted: SurfaceImageTransfer[] = [];
    for (const entry of raw as unknown[]) {
      const { transferId, bytes } = (entry ?? {}) as Partial<SurfaceImageTransfer>;
      if (typeof transferId !== "string" || !(bytes instanceof Uint8Array) || seen.has(transferId)) throw mismatch();
      const image = declared.get(transferId);
      if (!image) throw mismatch();
      seen.add(transferId);
      total += bytes.byteLength;
      if (total > LIMITS.totalBytes) throw new Error("IMAGE_TRANSFER_LIMIT");
      if (bytes.byteLength <= LIMITS.imageBytes && sniffImageMime(bytes) === image.mediaType) accepted.push({ transferId, bytes });
    }
    this.drop(transactionId);
    if (!accepted.length) return;
    const timer = this.timers.setTimer(() => { this.held.delete(transactionId); }, this.timers.deadlineMs);
    this.held.set(transactionId, { images: accepted, timer });
  }

  forward(transactionId: string): readonly SurfaceImageTransfer[] {
    return this.held.get(transactionId)?.images ?? [];
  }

  drop(transactionId: string) {
    const entry = this.held.get(transactionId);
    if (!entry) return;
    this.timers.clearTimer(entry.timer);
    this.held.delete(transactionId);
  }

  heldTransactions() {
    return this.held.size;
  }
}
