/**
 * [INPUT]: Closed encrypted classification models, wire validation and scoped business headers.
 * [OUTPUT]: Server-safe classification DTOs, immutable receipts and the two formal RPC contracts.
 * [POS]: Classification public entry; worker conversion has an explicit client subpath.
 */
import { id } from "../../../encryption/domains/scalars";
import { encryptedBusinessHeaderSchema as header } from "../../../spaces";
import { encryptedClassificationOperationSchema, encryptedClassificationReceiptSchema } from "./model";
export * from "./model";
export * from "./wire";
export const encryptedClassificationFunctions = {
  "chats/classification:apply": { kind: "mutation", args: header.extend({ operation: encryptedClassificationOperationSchema }).strict(), result: encryptedClassificationReceiptSchema },
  "chats/classification:receipt": { kind: "query", args: header.extend({ lifecycleOperationId: id }).strict(), result: encryptedClassificationReceiptSchema.nullable() },
} as const;
