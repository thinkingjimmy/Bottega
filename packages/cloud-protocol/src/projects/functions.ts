/**
 * [INPUT]: Depends on scoped business headers and closed Project operation/receipt schemas.
 * [OUTPUT]: Provides authorized Project intent, receipt, paginated metadata and indexed recent-Chat timestamp contracts.
 * [POS]: Public function registry partition shared by the backend and both client transports.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { encryptedProjectHeadSchema, encryptedProjectOperationSchema, encryptedProjectReceiptSchema } from "./encrypted";
const header = encryptedBusinessHeaderSchema.shape;
const page = z.object({ items: z.array(encryptedProjectHeadSchema).max(30), cursor: z.string().max(4096).nullable(), complete: z.boolean() }).strict();
export const projectFunctions = {
  "projects/api:list": { kind: "query", args: z.object({ ...header, cursor: z.string().max(4096).nullable() }).strict(), result: page },
  "projects/api:get": { kind: "query", args: z.object({ ...header, projectId: id }).strict(), result: encryptedProjectHeadSchema.nullable() },
  "projects/catalog:page": { kind: "query", args: z.object({ ...header, archived: z.boolean(), cursor: z.string().max(4096).nullable() }).strict(),
    result: page },
  "projects/catalog:recent": { kind: "query", args: z.object({ ...header, projectId: id, cursor: z.string().max(4096).nullable() }).strict(),
    result: z.object({ updatedAt: z.number().int().nonnegative().nullable(), cursor: z.string().max(4096).nullable(), complete: z.boolean() }).strict() },
  "projects/sync:apply": { kind: "mutation", args: z.object({ ...header, operation: encryptedProjectOperationSchema }).strict(), result: encryptedProjectReceiptSchema },
  "projects/sync:receipt": { kind: "query", args: z.object({ ...header, operationId: id }).strict(), result: encryptedProjectReceiptSchema.nullable() },
  "projects/sync:head": { kind: "query", args: z.object({ ...header, projectId: id }).strict(), result: encryptedProjectHeadSchema.nullable() },
  "projects/sync:page": { kind: "query", args: z.object({ ...header, afterId: id.nullable() }).strict(),
    result: page },
} as const;
export * from "./encrypted";
