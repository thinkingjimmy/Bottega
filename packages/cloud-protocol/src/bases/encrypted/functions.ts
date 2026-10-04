/**
 * [INPUT]: Required encrypted-space headers and bounded field CAS/read DTOs.
 * [OUTPUT]: Closed encrypted Base public functions with no plaintext transport alternative.
 * [POS]: Sole network registry for Base; native semantic operation codecs remain client-side.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../../spaces";
import { baseAuthorityOwnerSchema } from "../../encryption/domains/bases";
import { id, version } from "../../encryption/domains/scalars";
import { encryptedBaseInitialSchema, encryptedBaseCommitSchema, encryptedBaseReceiptSchema, encryptedBaseHeadSchema, encryptedBaseRowSchema,
  encryptedBaseConflictSchema, encryptedBaseLookupSchema, encryptedBaseFieldSchema } from "./model";
const header = encryptedBusinessHeaderSchema.shape;
const base = { ...header, baseId: id };
const pageInput = { cursor: z.string().max(2048).nullable() };
const page = { cursor: z.string().nullable(), complete: z.boolean() };
const changed = z.object({ status: z.literal("changed"), revision: version }).strict();
const encryptedBaseRowsPageSchema = z.union([changed, z.object({ ...page, status: z.literal("ready"), revision: version,
  items: z.array(encryptedBaseRowSchema).max(50) }).strict()]);
const encryptedBaseTombstonesPageSchema = z.union([changed, z.object({ ...page, status: z.literal("ready"), revision: version,
  items: z.array(z.string().min(1).max(384)).max(100) }).strict()]);
export const encryptedBaseCatalogItemSchema = z.object({ baseId: id, name: encryptedBaseFieldSchema, owner: baseAuthorityOwnerSchema,
  updatedAt: version, hasConflicts: z.boolean() }).strict();
export const encryptedBaseSnapshotSchema = z.object({ head: encryptedBaseHeadSchema, rows: z.array(encryptedBaseRowSchema).max(100),
  tombstones: z.array(z.string().min(1).max(384)).max(200), receipts: z.array(encryptedBaseReceiptSchema).max(64) }).strict();
export const encryptedBaseFunctions = {
  "bases/catalog/api:list": { kind: "query", args: z.object({ ...header, ...pageInput, projectId: id.nullable() }).strict(),
    result: z.object({ ...page, items: z.array(encryptedBaseCatalogItemSchema).max(20) }).strict() },
  "bases/catalog/api:syncPage": { kind: "query", args: z.object({ ...header, afterId: id.nullable() }).strict(),
    result: z.object({ cursor: id.nullable(), complete: z.boolean(), items: z.array(z.object({ baseId: id, owner: baseAuthorityOwnerSchema,
      cloudRevision: version }).strict()).max(20) }).strict() },
  "bases/api:ensure": { kind: "mutation", args: z.object({ ...header, initial: encryptedBaseInitialSchema }).strict(),
    result: z.object({ baseId: id, initial: encryptedBaseInitialSchema, created: z.boolean() }).strict() },
  "bases/api:applyOperations": { kind: "mutation", args: z.object({ ...header, commit: encryptedBaseCommitSchema }).strict(), result: encryptedBaseReceiptSchema },
  "bases/api:getReceipt": { kind: "query", args: z.object({ ...base, operationId: id }).strict(), result: encryptedBaseReceiptSchema.nullable() },
  "bases/api:readSnapshot": { kind: "query", args: z.object({ ...base, operationIds: z.array(id).max(64) }).strict(), result: encryptedBaseSnapshotSchema },
  "bases/pages:head": { kind: "query", args: z.object(base).strict(), result: encryptedBaseHeadSchema },
  "bases/pages:rows": { kind: "query", args: z.object({ ...base, revision: version, afterRevision: version.nullable(), ...pageInput }).strict(), result: encryptedBaseRowsPageSchema },
  "bases/pages:tombstones": { kind: "query", args: z.object({ ...base, revision: version, afterRevision: version.nullable(), ...pageInput }).strict(), result: encryptedBaseTombstonesPageSchema },
  "bases/conflicts:list": { kind: "query", args: z.object({ ...base, ...pageInput }).strict(),
    result: z.object({ ...page, items: z.array(encryptedBaseConflictSchema).max(20) }).strict() },
  "bases/conflicts:head": { kind: "query", args: z.object(base).strict(), result: version },
  "bases/conflicts:operation": { kind: "query", args: z.object({ ...base, operationId: id, resolutionOperationId: id.nullable() }).strict(), result: encryptedBaseLookupSchema.nullable() },
  "bases/conflicts:resolve": { kind: "mutation", args: z.object({ ...base, conflictId: id,
    action: z.enum(["apply", "discard"]), commit: encryptedBaseCommitSchema.nullable() }).strict(), result: encryptedBaseReceiptSchema.nullable() },
  "bases/conflicts:resolveOperation": { kind: "mutation", args: z.object({ ...base, sourceOperationId: id,
    action: z.enum(["apply", "discard"]), commit: encryptedBaseCommitSchema.nullable() }).strict(), result: encryptedBaseReceiptSchema.nullable() },
} as const;
