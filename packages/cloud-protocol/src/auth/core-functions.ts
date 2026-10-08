/**
 * [INPUT]: Depends on the closed config, account, device and library schemas.
 * [OUTPUT]: coreFunctions: the config, account, device and library entries of the public registry (the protocol-free shell update metadata query,
 *           the optional machine key on device registration/heartbeat, the account-level computer list and machine-wide rename, conditional heartbeat
 *           epoch replacement, nullable timestamped pending-count samples, allowlisted remote health and the library ownership publish).
 * [POS]: The first-screen table: Cloud Web's shell imports it alone instead of the merged registry (OPT-31); auth/functions.ts spreads it into cloudFunctions.
 */
import { z } from "zod";
import { deploymentHeaderSchema, protocolHeaderSchema, publicConfigSchema, updateInfoSchema } from "../config";
import { accountAccessSchema, cloudIdSchema, computerSchema, deviceNameSchema, devicePlatformSchema, deviceSchema, machineIdHashSchema, remoteHealthStatusSchema } from "./index";
import { libraryIdSchema, libraryOwnerSchema } from "./libraries";

const header = protocolHeaderSchema.shape;
export const coreFunctions = {
  "config:get": { kind: "query", args: protocolHeaderSchema, result: publicConfigSchema },
  /* No business-protocol gate: an outdated Web build inside the shell must still learn the App build it needs. */
  "config:updateInfo": { kind: "query", args: deploymentHeaderSchema, result: updateInfoSchema },
  "account:bootstrap": { kind: "mutation", args: protocolHeaderSchema, result: accountAccessSchema },
  "account:getAccessState": { kind: "query", args: protocolHeaderSchema, result: accountAccessSchema },
  "devices:register": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema, name: deviceNameSchema,
    platform: devicePlatformSchema, appVersion: z.string().min(1).max(100),
    /* Desktop only: a browser cannot name the computer it runs on, and an absent key simply leaves the
       installation ungrouped until the next registration or heartbeat carries one. */
    machineIdHash: machineIdHashSchema.optional(),
    /* The Bottega folder this installation holds. It names the ownership record every publish is admitted against,
       so it travels with registration rather than waiting for the first content write. */
    libraryId: libraryIdSchema.optional() }).strict(), result: deviceSchema },
  "devices:list": { kind: "query", args: z.object({ ...header, state: z.enum(["active", "revoked"]).optional(), cursor: z.string().max(2048).nullable() }).strict(),
    result: z.object({ devices: z.array(deviceSchema).max(100), cursor: z.string().nullable(), complete: z.boolean() }).strict() },
  "devices:heartbeat": { kind: "mutation", args: z.object({ ...header, connectionEpoch: cloudIdSchema, lastSeenReason: z.enum(["sleep", "quit"]).optional(),
    previousConnectionEpoch: cloudIdSchema.nullable().optional(), machineIdHash: machineIdHashSchema.optional(),
    libraryId: libraryIdSchema.optional(), outboxPending: z.number().int().min(0).max(1_000_000).nullable(), outboxSampledAt: z.number().int().min(0).nullable().optional(), remoteHealth: remoteHealthStatusSchema.optional() }).strict(), result: z.null() },
  /* One subscription per account, not one per Chat: the computer switcher, the row badges and the send gate
     all ask the same question — which computers exist and which of them can run a command right now. */
  "devices:computers": { kind: "query", args: protocolHeaderSchema, result: z.object({ computers: z.array(computerSchema).max(100) }).strict() },
  "devices:rename": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema, name: deviceNameSchema }).strict(), result: z.null() },
  /* Renames the computer, not one installation of it; a manual name that another computer already holds is
     refused rather than suffixed, because the person chose it. */
  "devices:renameComputer": { kind: "mutation", args: z.object({ ...header, machineIdHash: machineIdHashSchema, name: deviceNameSchema }).strict(), result: z.null() },
  "devices:revoke": { kind: "mutation", args: z.object({ ...header, deviceId: cloudIdSchema }).strict(), result: z.null() },
  /* Called once at the head of every synchronization pass: it creates the ownership record on the folder's first
     publication, adopts it for a newer installation of the same computer, and refuses `library-owned-elsewhere`
     for any other computer before a single byte of content is offered. */
  "libraries:publish": { kind: "mutation", args: z.object({ ...header, expectedUserId: cloudIdSchema, libraryId: libraryIdSchema }).strict(),
    result: libraryOwnerSchema },
} as const;
