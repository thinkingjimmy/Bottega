/**
 * [INPUT]: Closed encrypted generation DTOs and current authenticated immutable-space headers.
 * [OUTPUT]: Original import RPCs accepting and returning only ciphertext membership.
 * [POS]: Replaces plaintext imported transport; reads require the complete active generation.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../../../spaces";
import { cloudIdSchema as id } from "../../../auth";
import { versionSchema as rev } from "../../../scalars";
import { encryptedMessageSchema } from "../../encrypted/messages";
import { encryptedImportManifestSchema, encryptedImportStatusSchema, encryptedImportPageSchema, encryptedImportReceiptSchema } from "./model";
export const importedFunctions = {
  "chats/imported/api:begin": { kind: "mutation", args: header.extend({ manifest: encryptedImportManifestSchema }).strict(), result: encryptedImportStatusSchema },
  "chats/imported/api:publish": { kind: "mutation", args: header.extend({ operation: encryptedImportPageSchema }).strict(), result: encryptedImportReceiptSchema },
  "chats/imported/api:receipt": { kind: "query", args: header.extend({ operationId: id }).strict(), result: encryptedImportReceiptSchema.nullable() },
  "chats/imported/reads:head": { kind: "query", args: header.extend({ chatId: id }).strict(), result: encryptedImportStatusSchema.nullable() },
  "chats/imported/reads:page": { kind: "query", args: header.extend({ chatId: id, generationId: id, revision: rev,
    beforeSeq: rev.nullable(), limit: rev.positive().max(50) }).strict(), result: z.object({ entries: z.array(encryptedMessageSchema).max(50),
    next: rev.nullable(), complete: z.boolean() }).strict() },
} as const;
