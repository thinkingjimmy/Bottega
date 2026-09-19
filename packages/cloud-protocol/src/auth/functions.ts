/**
 * [INPUT]: Depends on closed account/device/environment schemas, immutable spaces, continuity and business registries.
 * [OUTPUT]: Provides the implemented public function registry with typed arguments/results and conditional heartbeat epoch replacement.
 * [POS]: Shared contract authority; private Convex exports are verified against this registry.
 */
import { z } from "zod";
import { protocolHeaderSchema, publicConfigSchema } from "../config";
import { accountAccessSchema, cloudIdSchema, deviceNameSchema, devicePlatformSchema, deviceSchema } from "./index";
import { baseFunctions } from "../bases/functions";
import { blobFunctions } from "../blobs/functions";
import { appFunctions } from "../apps/functions";
import { projectFunctions } from "../projects/functions";
import { chatFunctions } from "../chats/functions";
import { chatTranscriptFunctions } from "../chats/transcript/functions";
import { homeFunctions } from "../chats/home/functions";
import { importedFunctions } from "../chats/imported/functions";
import { turnFunctions } from "../turns/functions";
import { lifecycleFunctions } from "../lifecycle/functions";
import { remoteFunctions } from "../remote/functions";
import { continuityFunctions } from "../continuity/functions";
import { spacesFunctions } from "../spaces/functions";
import { skillFunctions } from "../skills/functions";
const header = protocolHeaderSchema.shape;
export const cloudFunctions = {
  ...skillFunctions,
  ...spacesFunctions,
  ...continuityFunctions,
  ...remoteFunctions,
  ...lifecycleFunctions,
  ...baseFunctions,
  ...blobFunctions,
  ...appFunctions,
  ...projectFunctions,
  ...chatFunctions,
  ...chatTranscriptFunctions,
  ...homeFunctions,
  ...importedFunctions,
  ...turnFunctions,
  "config:get": { kind: "query", args: protocolHeaderSchema, result: publicConfigSchema },
  "account:bootstrap": { kind: "mutation", args: protocolHeaderSchema, result: accountAccessSchema },
  "account:getAccessState": { kind: "query", args: protocolHeaderSchema, result: accountAccessSchema },
  "devices:register": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema, name: deviceNameSchema,
    platform: devicePlatformSchema, appVersion: z.string().min(1).max(100) }).strict(), result: deviceSchema },
  "devices:list": { kind: "query", args: z.object({ ...header, state: z.enum(["active", "revoked"]).optional(), cursor: z.string().max(2048).nullable() }).strict(),
    result: z.object({ devices: z.array(deviceSchema).max(100), cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "devices:heartbeat": { kind: "mutation", args: z.object({ ...header, connectionEpoch: cloudIdSchema, lastSeenReason: z.enum(["sleep", "quit"]).optional(),
    previousConnectionEpoch: cloudIdSchema.nullable().optional(),
    outboxPending: z.number().int().min(0).max(1_000_000) }).strict(), result: z.null() },
  "devices:rename": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema, name: deviceNameSchema }).strict(), result: z.null() },
  "devices:revoke": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema }).strict(), result: z.null() },
} as const;
export type CloudFunctionName = keyof typeof cloudFunctions;
export type CloudFunctionArgs<N extends CloudFunctionName> = z.infer<(typeof cloudFunctions)[N]["args"]>;
export type CloudFunctionResult<N extends CloudFunctionName> = z.infer<(typeof cloudFunctions)[N]["result"]>;
