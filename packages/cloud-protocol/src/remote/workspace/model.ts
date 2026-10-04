/**
 * [INPUT]: Encrypted-space authority, Project/computer identities and closed relative-path results.
 * [OUTPUT]: Read-only pre-Chat workspace query packets with 60-second connection-bound authorization.
 * [POS]: Query library independent from Chat creation and execution; no Chat is allocated by suggestions.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { encryptedSpaceSchema, encryptedBusinessHeaderSchema } from "../../spaces";
import { remotePacketSchema } from "../encrypted/model";
import { remoteWorkspaceListSchema } from "../input/references";
import { remoteProjectQueryBindingSchema, createRemoteProjectQueryContext, type CryptoScope } from "../../encryption";
import { hashCanonical } from "../../encryption/encoding";
export const projectQueryInputSchema = z.object({ targetDeviceId: id, projectId: id, query: z.string().max(256) }).strict();
export const projectQuerySchema = z.object({ queryId: z.uuid(), binding: remoteProjectQueryBindingSchema, packet: remotePacketSchema }).strict();
export const projectQueryResultSchema = z.discriminatedUnion("kind", [remoteWorkspaceListSchema,
  z.object({ kind: z.literal("unavailable"), reason: z.enum(["workspace-file-unavailable", "workspace-changed"]) }).strict()]);
export type ProjectQuery = z.infer<typeof projectQuerySchema>;
export const projectQueryContext = (scope: CryptoScope, query: Pick<ProjectQuery, "queryId" | "binding">, requestHash: string | null = null) =>
  createRemoteProjectQueryContext(scope, query.queryId, hashCanonical({ ...query.binding, requestHash }), { ...query.binding, requestHash });
const header = encryptedBusinessHeaderSchema.shape;
const receipt = z.object({ request: projectQuerySchema, encryptedSpace: encryptedSpaceSchema, result: remotePacketSchema.nullable() }).strict();
export const projectQueryFunctions = {
  "remote/workspace:submit": { kind: "mutation", args: z.object({ ...header, request: projectQuerySchema }).strict(), result: z.null() },
  "remote/workspace:get": { kind: "query", args: z.object({ ...header, queryId: z.uuid() }).strict(), result: receipt.nullable() },
  "remote/workspace:inbox": { kind: "query", args: z.object({ ...header, connectionEpoch: id }).strict(), result: z.array(receipt).max(20) },
  "remote/workspace:report": { kind: "mutation", args: z.object({ ...header, queryId: z.uuid(), connectionEpoch: id, result: remotePacketSchema }).strict(), result: z.null() },
} as const;
