/**
 * [INPUT]: Depends on Zod, the encryption scalars, the purpose-13 plaintext limit, the encrypted-space schema and the App id.
 * [OUTPUT]: Provides APP_BUILD_LIMITS, the closed phases, failure codes and deciders, the sealed body (appBuildStatusSchema), the encrypted Includes encrypted enabled state and its independent revision.
 *           record with its plaintext header (encryptedAppBuildStatusSchema) and the publish receipt.
 * [POS]: U06-d: what a phone or Web learns about an App's build on its owner computer, one row per App written only by that desktop.
 *        Closed codes only: no error text, path, log or extension detail ever enters it.
 */
import { z } from "zod";
import { digest, id, version } from "../../encryption/domains/scalars";
import { PLAINTEXT_LIMITS } from "../../encryption/limits";
import { encryptedSpaceSchema } from "../../spaces";
import { appIdSchema } from "../model";

const envelopeBytes = Math.ceil(PLAINTEXT_LIMITS[13] * 4 / 3) + 8_192;
export const APP_BUILD_LIMITS = Object.freeze({ plaintextBytes: PLAINTEXT_LIMITS[13], envelopeBytes, packetChars: Math.ceil(envelopeBytes * 4 / 3),
  deviceNameChars: 120, extensions: 64,
  /** How long a build waits for the extension decision before it is declined as timed out (Q-U13), with a window or without. */
  confirmWaitMs: 30 * 60_000 });
export const APP_BUILD_PHASES = ["idle", "building", "waiting-confirm", "failed"] as const;
/** `interrupted`: Bottega on the owner computer closed during the build (a crash or a quit), found on the next start. */
export const APP_BUILD_FAILURES = ["build-failed", "compatibility-blocked", "interrupted"] as const;
export const APP_EXTENSION_DECIDERS = ["local", "remote", "timeout"] as const;

const outcomeSchema = z.discriminatedUnion("kind", [
  /* The last attempt's extension was declined: here, from another device (named), or by the 30-minute bound. The build went on without it. */
  z.object({ kind: z.literal("declined"), by: z.enum(APP_EXTENSION_DECIDERS), deviceName: z.string().min(1).max(APP_BUILD_LIMITS.deviceNameChars).optional() }).strict()
    .refine(value => (value.by === "remote") === (value.deviceName !== undefined), "remote-decline-names-its-device"),
  z.object({ kind: z.literal("failed"), code: z.enum(APP_BUILD_FAILURES) }).strict(),
]);
/** The sealed body. `confirm` exists exactly while the build waits for the extension decision; `failed` exactly with a failed outcome. */
export const appBuildStatusSchema = z.object({
  enabled: z.boolean(), enabledRevision: version,
  appId: appIdSchema, phase: z.enum(APP_BUILD_PHASES), attemptId: id.nullable(), startedAt: version.nullable(), updatedAt: version,
  confirm: z.object({ requestId: id, extensionCount: version.positive().max(APP_BUILD_LIMITS.extensions), expiresAt: version }).strict().nullable(),
  outcome: outcomeSchema.nullable(),
}).strict()
  .refine(value => (value.phase === "waiting-confirm") === (value.confirm !== null), "confirm-only-while-waiting")
  .refine(value => (value.phase === "failed") === (value.outcome?.kind === "failed"), "failed-phase-has-failed-outcome")
  .refine(value => value.phase === "idle" || value.attemptId !== null && value.startedAt !== null, "an-attempt-has-its-identity");
export type AppBuildStatus = z.infer<typeof appBuildStatusSchema>;

const packetSchema = z.object({ envelope: z.string().min(1).max(APP_BUILD_LIMITS.packetChars).regex(/^[A-Za-z0-9_-]+$/), ciphertextHash: digest,
  ciphertextBytes: version.positive().max(APP_BUILD_LIMITS.envelopeBytes) }).strict();
/** The plaintext header names only the App, its owner and the revision; the phase itself is sealed. */
export const encryptedAppBuildStatusSchema = z.object({ appId: appIdSchema, ownerDeviceId: id, revision: version.positive(), operationId: id,
  encryptedSpace: encryptedSpaceSchema, packet: packetSchema }).strict();
export type EncryptedAppBuildStatus = z.infer<typeof encryptedAppBuildStatusSchema>;
export const appBuildReceiptSchema = z.discriminatedUnion("status", [
  z.object({ operationId: id, status: z.literal("applied"), revision: version.positive() }).strict(),
  z.object({ operationId: id, status: z.literal("conflicted"), current: z.object({ revision: version.positive() }).strict().nullable() }).strict(),
]);
export type AppBuildReceipt = z.infer<typeof appBuildReceiptSchema>;
