/**
 * [INPUT]: Depends on fixed build/deployment identity, strict JSON persistence and explicit first-sync consent.
 * [OUTPUT]: Owns durable account binding with required encrypted consent, initialization checkpoints, credential-dependent enrollment and cleanup-before-rebinding.
 * [POS]: Main-only sync lifecycle metadata; business snapshots, queues and credentials remain with their existing owners.
 */
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { deploymentIdSchema, environmentIdSchema, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { cryptoScopeSchema } from "@ai-chat/cloud-protocol/spaces";
import { storageHashSchema, storageIdSchema, type RuntimeStorageMode } from "../../../../../shared/local-storage/contracts";
import { DurableJson, isErrnoCode, type DurableReplaceFileFaults } from "../../../persistence/durable-json";

export const INITIAL_PARTICIPANTS = ["projects", "chats", "bases", "apps", "files", "homes"] as const;
const participantSchema = z.enum(INITIAL_PARTICIPANTS);
const cleanupReasonSchema = z.enum(["signed-out", "revoked", "disabled", "account-switch", "account-deleted", "credentials-unavailable"]);
const bindingSchema = z.object({ userId: storageIdSchema, deviceId: storageIdSchema, manifestId: storageIdSchema,
  consentHash: storageHashSchema, encryption: z.object({ scope: cryptoScopeSchema, keyPackageFingerprint: storageHashSchema }).strict().nullable().default(null), approvedAt: z.number().int().nonnegative(), phase: z.enum(["initializing", "active", "closing"]),
  paused: z.boolean(), checkpoints: z.array(z.object({ participant: participantSchema, evidenceHash: storageHashSchema }).strict()).max(6),
  cleanup: z.object({ operationId: storageIdSchema, reason: cleanupReasonSchema }).strict().nullable(),
}).strict().superRefine((binding, ctx) => {
  if (new Set(binding.checkpoints.map(item => item.participant)).size !== binding.checkpoints.length ||
      (binding.phase === "closing") !== Boolean(binding.cleanup) || binding.phase === "active" && binding.checkpoints.length !== INITIAL_PARTICIPANTS.length) {
    ctx.addIssue({ code: "custom", message: "Invalid synchronization lifecycle" });
  }
});
const fileSchema = z.object({ version: z.literal(1), environmentId: environmentIdSchema,
  deploymentId: deploymentIdSchema, binding: bindingSchema.nullable() }).strict();
export type SyncBinding = z.infer<typeof bindingSchema>;
/** Approval always carries it; the file stays nullable only so a legacy binding is still detected. */
export type SyncConsent = NonNullable<SyncBinding["encryption"]>;
type SyncBindingFile = z.infer<typeof fileSchema>;

export class SyncBindingStore {
  private readonly file: DurableJson<SyncBindingFile>;
  private enrollmentRestricted = false;
  constructor(userData: string, private readonly config: CloudBuildConfig, faults: DurableReplaceFileFaults = {}) {
    const schema = fileSchema.refine(value => value.environmentId === config.environmentId && value.deploymentId === config.deploymentId,
      "Synchronization deployment identity changed");
    this.file = new DurableJson(join(userData, "cloud-sync-binding.json"), schema,
      () => ({ version: 1, environmentId: config.environmentId, deploymentId: config.deploymentId, binding: null }), faults);
  }
  async initialize() {
    try {
      const stat = await lstat(this.file.filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65_536) throw new Error("sync-binding-invalid");
    } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
    await this.file.initialize();
  }
  snapshot() { return this.file.snapshot().binding; }
  mode(): RuntimeStorageMode {
    const binding = this.snapshot();
    return binding ? { kind: "sync", scope: { environment: this.config.environmentId, userId: binding.userId },
      enrollment: binding.phase === "closing" || this.enrollmentRestricted ? "closed" : "open" } : { kind: "local-only" };
  }
  restrictEnrollment(restricted: boolean) { this.enrollmentRestricted = restricted; }
  assertAccount(userId: string, deviceId: string) {
    const binding = this.snapshot();
    if (binding && (binding.userId !== userId || binding.deviceId !== deviceId || binding.phase === "closing")) throw new Error("previous-account-cleanup-required");
  }
  approve(input: Pick<SyncBinding, "userId" | "deviceId" | "manifestId" | "consentHash"> & { encryption: SyncConsent }) {
    return this.file.mutate(file => {
      const previous = file.binding;
      if (previous) {
        if (previous.phase === "closing" || ["userId", "deviceId", "manifestId", "consentHash"].some(key => previous[key as keyof typeof input] !== input[key as keyof typeof input])) {
          throw new Error("SYNC_APPROVAL_IDENTITY_CONFLICT");
        }
        if (JSON.stringify(previous.encryption) !== JSON.stringify(input.encryption)) throw new Error("SYNC_APPROVAL_IDENTITY_CONFLICT");
        return previous;
      }
      /* Consent lands paused: the setup operation that wrote it is the only thing allowed to start it. */
      file.binding = bindingSchema.parse({ ...input, approvedAt: Date.now(), phase: "initializing", paused: true, checkpoints: [], cleanup: null });
      return file.binding;
    });
  }
  checkpoint(manifestId: string, participant: typeof INITIAL_PARTICIPANTS[number], evidenceHash: string) {
    return this.file.mutate(file => {
      const binding = file.binding;
      if (!binding || binding.manifestId !== manifestId || binding.phase === "closing") throw new Error("SYNC_INITIALIZATION_SUPERSEDED");
      const previous = binding.checkpoints.find(item => item.participant === participant);
      if (previous) {
        if (previous.evidenceHash !== evidenceHash) throw new Error("SYNC_CHECKPOINT_CONFLICT");
        return binding;
      }
      binding.checkpoints.push({ participant: participantSchema.parse(participant), evidenceHash: storageHashSchema.parse(evidenceHash) });
      if (binding.checkpoints.length === INITIAL_PARTICIPANTS.length) binding.phase = "active";
      return binding;
    });
  }
  setPaused(paused: boolean) {
    return this.file.mutate(file => {
      if (!file.binding || file.binding.phase === "closing") throw new Error("SYNC_SCOPE_UNAVAILABLE");
      file.binding.paused = z.boolean().parse(paused); return file.binding;
    });
  }
  beginCleanup(reason: z.infer<typeof cleanupReasonSchema>) {
    return this.file.mutate(file => {
      if (!file.binding) return null;
      if (!file.binding.cleanup) file.binding.cleanup = { operationId: randomUUID(), reason: cleanupReasonSchema.parse(reason) };
      file.binding.phase = "closing"; return file.binding;
    });
  }
  finishCleanup(operationId: string, verifyDetached: (binding: SyncBinding) => Promise<void>) {
    return this.file.mutate(async file => {
      if (!file.binding) return;
      if (file.binding.phase !== "closing" || file.binding.cleanup?.operationId !== operationId) throw new Error("SYNC_CLEANUP_IDENTITY_CONFLICT");
      await verifyDetached(structuredClone(file.binding)); file.binding = null;
    });
  }
  close() { return this.file.closeAndFlush(); }
}
