/**
 * [INPUT]: Admitted immutable crypto scope, closed worker commands and the original native Base operation.
 * [OUTPUT]: Client codec ports and separate plaintext/ciphertext frozen transport identity.
 * [POS]: Shared desktop/Web seam; neither content keys nor a second business queue cross this boundary.
 */
import { z } from "zod";
import { assertCrypto, type CryptoContext, type CryptoScope } from "../../../encryption";
import { referencesSchema } from "../../../encryption/domains/scalars";
import { encryptedBaseCommitSchema, type EncryptedBaseCommit, type BaseCipherTarget } from "../model";
import { hashCanonical } from "../../../encryption/encoding";
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor } from "../../../blobs/encrypted/model";
export const hashBaseSemanticValue = hashCanonical;
type BaseCipherCommand = { kind: "encrypt"; context: CryptoContext; plaintext: Uint8Array } |
  { kind: "decrypt"; expectedContext: CryptoContext; envelope: Uint8Array };
export interface BaseCipherPort {
  scope: CryptoScope;
  keyPackageFingerprint: string;
  session: { userId: string; sessionId: string; deviceId: string };
  run(command: BaseCipherCommand, signal?: AbortSignal): Promise<unknown>;
}
export type BaseCipherReference = z.infer<typeof referencesSchema>[number];
export interface BaseCipherFiles {
  prepare(value: unknown, target: BaseCipherTarget): Promise<{ value: unknown; references: BaseCipherReference[] }>;
  open(value: unknown, target: BaseCipherTarget, references: BaseCipherReference[]): Promise<unknown>;
}
export const frozenBaseTransportSchema = z.object({ plaintextHash: z.string().regex(/^[a-f0-9]{64}$/),
  ciphertextHash: z.string().regex(/^[a-f0-9]{64}$/), commit: encryptedBaseCommitSchema }).strict()
  .refine(value => value.ciphertextHash === value.commit.ciphertextHash);
export type FrozenBaseTransport = z.infer<typeof frozenBaseTransportSchema>;
export const frozenPair = (plaintextHash: string, commit: EncryptedBaseCommit): FrozenBaseTransport => frozenBaseTransportSchema.parse({ plaintextHash, ciphertextHash: commit.ciphertextHash, commit });
export function assertResult(value: unknown, kind: "encrypted" | "decrypted"): asserts value is {
  kind: "encrypted" | "decrypted"; envelope: Uint8Array; plaintext: Uint8Array; ciphertextHash: string;
} {
  assertCrypto(value !== null && typeof value === "object" && "kind" in value && value.kind === kind);
  assertCrypto(kind === "encrypted" ? "envelope" in value && value.envelope instanceof Uint8Array : "plaintext" in value && value.plaintext instanceof Uint8Array);
}
export const encryptedBaseAttachmentSchema = z.object({ schema: z.literal("bottega.base-file/v1"),
  value: baseAttachmentValueSchema, file: encryptedFileDescriptorSchema }).strict();
export function bindBaseAttachment(value: z.infer<typeof baseAttachmentValueSchema>, file: EncryptedFileDescriptor, baseId: string) {
  const hash = /^att_([a-f0-9]{64})\.(png|jpe?g|webp|gif)$/.exec(value.blobId)?.[1];
  assertCrypto(!value.localAvailability && hash === file.sha256 && value.byteLength === file.bytes && value.mediaType === file.mime &&
    file.encryption.owner.kind === "base" && file.encryption.owner.id === baseId);
  return encryptedBaseAttachmentSchema.parse({ schema: "bottega.base-file/v1", value, file });
}
export function baseAttachmentReferences(file: EncryptedFileDescriptor): BaseCipherReference[] {
  return [{ blobId: file.blobId, ciphertextHash: file.encryption.sha256, ciphertextBytes: file.encryption.bytes }];
}
