/**
 * [INPUT]: Depends on encrypted-space headers and bounded ciphertext Home publication contracts.
 * [OUTPUT]: Provides typed encrypted Home begin/page/receipt and bounded opaque entry reads.
 * [POS]: Home RPC allowlist; only the current desktop executor can publish snapshots.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../../spaces";
import { cloudIdSchema as id } from "../../auth";
import { versionSchema as rev } from "../../scalars";
import { encryptedHomeEntrySchema, encryptedHomeManifestSchema, encryptedHomePageSchema, encryptedHomeReceiptSchema, encryptedHomeStatusSchema } from "./encrypted";
const scope = encryptedBusinessHeaderSchema.shape;
export const homeFunctions = {
  "chats/home/api:begin": { kind: "mutation", args: z.object({ ...scope, manifest: encryptedHomeManifestSchema }).strict(), result: encryptedHomeStatusSchema },
  "chats/home/api:publish": { kind: "mutation", args: z.object({ ...scope, operation: encryptedHomePageSchema }).strict(), result: encryptedHomeReceiptSchema },
  "chats/home/api:receipt": { kind: "query", args: z.object({ ...scope, operationId: id }).strict(), result: encryptedHomeReceiptSchema.nullable() },
  "chats/home/reads:head": { kind: "query", args: z.object({ ...scope, chatId: id, snapshotId: id }).strict(), result: encryptedHomeStatusSchema.nullable() },
  "chats/home/reads:page": { kind: "query", args: z.object({ ...scope, chatId: id, snapshotId: id, after: rev, limit: rev.positive().max(50) }).strict(),
    result: z.object({ entries: z.array(encryptedHomeEntrySchema).max(50), next: rev, complete: z.boolean() }).strict() },
} as const;
