/**
 * [INPUT]: Authenticated artifact fences and encrypted file manifests returned by the reference service.
 * [OUTPUT]: Reconstructs a validated private file descriptor bound to the exact Chat owner.
 * [POS]: Shared artifact download boundary before plaintext decryption and hash validation.
 */
import { encryptedFileDescriptorSchema, encryptedFileManifestSchema } from "../blobs/encrypted";
import type { ArtifactFence } from "../turns/text/artifact-reference";

export function describeArtifactFile(fence: ArtifactFence, chatId: string, manifest: unknown) {
  const encryption = encryptedFileManifestSchema.parse(manifest);
  if (encryption.owner.kind !== "chat" || encryption.owner.id !== chatId) throw new Error("artifact-owner-mismatch");
  return encryptedFileDescriptorSchema.parse({ blobId: encryption.blobId,
    sha256: fence.sha256, bytes: fence.bytes, mime: fence.mime, encryption });
}
