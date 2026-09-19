/**
 * [INPUT]: Depends on the Base preload boundary, immutable File slices and shared incremental hashing.
 * [OUTPUT]: Stages 50 MB images through 1 MiB parts, discards drafts and commits records with frozen field baselines.
 * [POS]: Desktop Base platform adapter; only opaque transfer identities accompany verified attachment values.
 */
import { hashBlobSource, hashBytes } from "@ai-chat/cloud-protocol";
import { BASE_IMAGE_PART_BYTES, baseRecordCommitSchema, imageBeginSchema, imageStatusSchema,
  type ImageTransferRequest, type ImageReply } from "@ai-chat/base-ui/attachments/native-images";
import type { BaseAttachmentFacade, BaseRecordMutation } from "@ai-chat/base-ui/ui/platform/contracts";
import { isBaseAttachmentValue } from "@ai-chat/base-ui/model/base-values";
import { baseImagesBridge } from "./client";

const manifests = new WeakMap<File, Awaited<ReturnType<typeof hashBlobSource>>>();
const transfers = new Map<string, ImageTransferRequest>();
const values = new WeakMap<object, string>();
function unwrap<T>(reply: ImageReply<T>): T {
  if (!reply.ok) throw Object.assign(new Error(reply.error.code), reply.error);
  return reply.value;
}

export const stageNativeBaseImage: NonNullable<BaseAttachmentFacade["stageImage"]> = async (input, signal, progress) => {
  signal.throwIfAborted();
  const { file, ...scope } = input;
  const source = { bytes: file.size, mime: file.type, read: async (offset: number, bytes: number) => new Uint8Array(await file.slice(offset, offset + bytes).arrayBuffer()) };
  let transfer: ImageTransferRequest | undefined;
  const cancel = () => { if (transfer) void baseImagesBridge().cancel(transfer).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const manifest = manifests.get(file) ?? await hashBlobSource(source, signal, progress, BASE_IMAGE_PART_BYTES);
    manifests.set(file, manifest);
    const begin = imageBeginSchema.parse({ ...scope, filename: file.name, mediaType: file.type, byteLength: file.size, sha256: manifest.sha256 });
    const bridge = baseImagesBridge();
    let status = imageStatusSchema.parse(unwrap(await bridge.begin(begin)));
    transfer = { ownerKey: input.ownerKey, ownerInstanceId: input.ownerInstanceId, surfaceLeaseId: input.surfaceLeaseId, transferId: status.transferId };
    transfers.set(input.uploadId, transfer); signal.throwIfAborted();
    if (status.offset > file.size || status.offset !== file.size && status.offset % BASE_IMAGE_PART_BYTES !== 0) throw new Error("image_transfer_conflict");
    let offset = 0;
    for (const part of manifest.parts) {
      signal.throwIfAborted();
      if (offset >= status.offset) {
        const bytes = await source.read(offset, part.bytes); signal.throwIfAborted();
        if (bytes.byteLength !== part.bytes || hashBytes(bytes) !== part.sha256) throw new Error("image_transfer_conflict");
        status = imageStatusSchema.parse(unwrap(await bridge.part({ ...transfer, offset, bytes, sha256: part.sha256 })));
        if (status.transferId !== transfer.transferId || status.offset !== offset + part.bytes) throw new Error("image_transfer_conflict");
      }
      offset += part.bytes; progress?.({ phase: "uploading", bytes: offset, total: file.size });
    }
    signal.throwIfAborted(); progress?.({ phase: "verifying", bytes: file.size, total: file.size });
    status = imageStatusSchema.parse(unwrap(await bridge.finish(transfer))); signal.throwIfAborted();
    const value = status.value;
    if (status.transferId !== transfer.transferId || status.offset !== file.size || !value || value.byteLength !== file.size ||
      value.mediaType !== file.type || value.filename !== file.name || !value.blobId.startsWith(`att_${manifest.sha256}.`)) throw new Error("image_transfer_conflict");
    values.set(value, transfer.transferId); return value;
  } catch (cause) {
    if (signal.aborted && transfer) {
      transfers.delete(input.uploadId);
      await baseImagesBridge().cancel(transfer).catch(() => undefined);
    }
    throw cause;
  } finally { signal.removeEventListener("abort", cancel); }
};
export async function discardNativeBaseImages(uploadIds: string[]) {
  await Promise.all(uploadIds.map(async id => {
    const transfer = transfers.get(id); if (!transfer) return;
    transfers.delete(id); unwrap(await baseImagesBridge().cancel(transfer));
  }));
}
export async function commitNativeBaseRecord(input: BaseRecordMutation) {
  const stagedImages: Record<string, string> = {};
  for (const [columnId, value] of Object.entries(input.patch)) {
    if (value && typeof value === "object" && isBaseAttachmentValue(value)) {
      const transferId = values.get(value); if (transferId) stagedImages[columnId] = transferId;
    }
  }
  const request = baseRecordCommitSchema.parse({ ...input, stagedImages });
  return unwrap(await baseImagesBridge().commitRecord(request));
}
export const previewNativeBaseImage: BaseAttachmentFacade["preview"] = async ({ value, baseOwner, maxEdge }, signal) => {
  if (!baseOwner) return null;
  signal.throwIfAborted();
  const result = unwrap(await baseImagesBridge().thumbnail({ ...baseOwner, value, maxEdge: Math.min(1024, maxEdge) }));
  signal.throwIfAborted(); return result ? { url: result.dataUrl, release() {} } : null;
};
