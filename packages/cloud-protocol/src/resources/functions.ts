/**
 * [INPUT]: Depends on the encrypted business header and the resource-command model.
 * [OUTPUT]: Provides `resources/commands:submit` (the sender), `inbox` (the target's unfinished commands), `settle` (the target's accepted / final result) and `receipts` (≤ 20 by id).
 * [POS]: Resource-command function registry (protocol 13), spread into the shared cloud function registry.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema as header } from "../spaces";
import { digest, id, version } from "../encryption/domains/scalars";
import { encryptedResourceCommandSchema, encryptedResourceResultSchema, RESOURCE_LIMITS, resourceReceiptSchema } from "./model";
export const resourceFunctions = {
  "resources/commands:submit": { kind: "mutation", args: header.extend({ command: encryptedResourceCommandSchema }).strict(), result: resourceReceiptSchema },
  /* Subscribed by the target desktop: pending and accepted commands addressed to the calling device. */
  "resources/commands:inbox": { kind: "query", args: header,
    result: z.object({ items: z.array(z.object({ command: encryptedResourceCommandSchema, state: z.enum(["pending", "accepted"]) }).strict()).max(RESOURCE_LIMITS.inboxItems) }).strict() },
  "resources/commands:settle": { kind: "mutation", args: header.extend({ commandId: id, ciphertextHash: digest, result: encryptedResourceResultSchema }).strict(),
    result: resourceReceiptSchema },
  "resources/commands:receipts": { kind: "query", args: header.extend({ commandIds: z.array(id).min(1).max(RESOURCE_LIMITS.receiptsPerRead) }).strict(),
    result: z.object({ items: z.array(resourceReceiptSchema).max(RESOURCE_LIMITS.receiptsPerRead), serverTime: version }).strict() },
} as const;
