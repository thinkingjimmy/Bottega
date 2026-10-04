/**
 * [INPUT]: Depends on current account/immutable-space headers and closed permanent deletion contracts.
 * [OUTPUT]: Provides revision-CAS deletion results, original conflict receipts and bounded ordered tombstone reads.
 * [POS]: Lifecycle RPC registry shared by desktop and browser clients.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { versionSchema as rev } from "../scalars";
import { cloudIdSchema as id } from "../auth";
import { deletionOperationSchema, deletionResultSchema, tombstoneSchema } from "./model";
const header = encryptedBusinessHeaderSchema.shape;
export const lifecycleFunctions = {
  "lifecycle/api:remove": { kind: "mutation", args: z.object({ ...header, operation: deletionOperationSchema }).strict(), result: deletionResultSchema },
  "lifecycle/api:receipt": { kind: "query", args: z.object({ ...header, operationId: id }).strict(), result: deletionResultSchema.nullable() },
  "lifecycle/api:head": { kind: "query", args: encryptedBusinessHeaderSchema, result: z.object({ revision: rev }).strict() },
  "lifecycle/api:page": { kind: "query", args: z.object({ ...header, afterRevision: rev, throughRevision: rev }).strict(),
    result: z.object({ items: z.array(tombstoneSchema).max(50), cursor: rev, complete: z.boolean() }).strict() },
} as const;
