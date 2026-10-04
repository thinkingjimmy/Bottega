/**
 * [INPUT]: Depends on business authorization headers and closed Chat metadata contracts.
 * [OUTPUT]: Provides initial/metadata/classification/owner-option transactions, immutable receipts and revision-fenced catalogs.
 * [POS]: Shared RPC partition consumed by both clients and audited against the private backend.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { encryptedChatFunctions } from "./encrypted/functions";
import { encryptedOptionsOperationSchema, encryptedOptionsReceiptSchema } from "./encrypted/options";
import { encryptedClassificationFunctions } from "./encrypted/classification";
const header = encryptedBusinessHeaderSchema.shape;
export const chatFunctions = {
  ...encryptedClassificationFunctions,
  "chats/options:apply": { kind: "mutation", args: z.object({ ...header, operation: encryptedOptionsOperationSchema }).strict(), result: encryptedOptionsReceiptSchema.nullable() },
  "chats/options:receipt": { kind: "query", args: z.object({ ...header, operationId: id }).strict(), result: encryptedOptionsReceiptSchema.nullable() },
  ...encryptedChatFunctions,
} as const;
