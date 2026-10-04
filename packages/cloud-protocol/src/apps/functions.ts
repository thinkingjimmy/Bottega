/**
 * [INPUT]: Depends on account-bound protocol headers and strict App operation/source contracts.
 * [OUTPUT]: Defines catalog, confirmed deletion disposition, lifecycle, candidate verification, package activation and build-status (U06-d) RPC contracts.
 * [POS]: Public App service surface; typed data access grants no local installation or execution authority.
 */
import { z } from "zod";
import { encryptedBusinessHeaderSchema } from "../spaces";
import { cloudIdSchema as id } from "../auth";
import { appIdSchema, appDeletionSchema } from "./model";
import { appBuildReceiptSchema, encryptedAppBuildStatusSchema } from "./build-status/model";
import { encryptedAppHeadSchema, encryptedAppOperationSchema, encryptedAppReceiptSchema, encryptedAppCandidateSchema, encryptedAppPackageSchema } from "./encrypted";
const header = encryptedBusinessHeaderSchema.shape;
const app = { ...header, appId: appIdSchema }, operation = { ...app, operationId: id };
export const appFunctions = {
  "apps/api:apply": { kind: "mutation", args: z.object({ ...header, operation: encryptedAppOperationSchema }).strict(), result: encryptedAppReceiptSchema },
  "apps/api:get": { kind: "query", args: z.object(app).strict(), result: encryptedAppHeadSchema.nullable() },
  "apps/api:deletion": { kind: "query", args: z.object(app).strict(), result: appDeletionSchema.nullable() },
  "apps/api:list": { kind: "query", args: z.object({ ...header, cursor: z.string().max(2048).nullable() }).strict(),
    result: z.object({ items: z.array(encryptedAppHeadSchema).max(30), cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "apps/api:receipt": { kind: "query", args: z.object(operation).strict(), result: encryptedAppReceiptSchema.nullable() },
  "apps/packages:stage": { kind: "mutation", args: z.object({ ...header, candidate: encryptedAppOperationSchema }).strict(), result: encryptedAppCandidateSchema },
  "apps/packages:candidate": { kind: "query", args: z.object(operation).strict(), result: encryptedAppCandidateSchema.nullable() },
  "apps/packages:activate": { kind: "mutation", args: z.object(operation).strict(), result: encryptedAppReceiptSchema },
  "apps/packages:get": { kind: "query", args: z.object({ ...app, packageRevision: z.number().int().positive() }).strict(), result: encryptedAppPackageSchema.nullable() },
  /* U06-d: one build-status row per App; only the App's owner desktop publishes it, every device of the account reads it. */
  "apps/build:publish": { kind: "mutation", args: z.object({ ...header, record: encryptedAppBuildStatusSchema }).strict(), result: appBuildReceiptSchema },
  "apps/build:get": { kind: "query", args: z.object(app).strict(), result: encryptedAppBuildStatusSchema.nullable() },
} as const;
