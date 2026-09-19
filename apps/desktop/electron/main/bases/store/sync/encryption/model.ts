/**
 * [INPUT]: Closed encrypted file descriptors and local immutable ciphertext sidecar identities.
 * [OUTPUT]: Bounded file custody attached to the existing Base synchronization envelope.
 * [POS]: Domain-owned exact retry references; contains no independent work queue.
 */
import { z } from "zod";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
export const baseEncryptionFilesSchema = z.object({
  records: z.record(z.string().min(1).max(160), z.object({ operationId: z.string().min(1).max(128), hash: z.string().regex(/^[a-f0-9]{64}$/), blobId: z.uuid().optional() }).strict())
    .refine(value => Object.keys(value).length <= 16384),
  images: z.record(z.string().min(1).max(160), z.object({ descriptor: encryptedFileDescriptorSchema, journalKey: z.string().max(128).nullable() }).strict())
    .refine(value => Object.keys(value).length <= 10000),
}).strict();
export type BaseEncryptionFiles = z.infer<typeof baseEncryptionFilesSchema>;
