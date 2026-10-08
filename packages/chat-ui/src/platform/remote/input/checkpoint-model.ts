/**
 * [INPUT]: Depends on opaque plugin source metadata and closed remote attachment, reference, creation and command schemas; no DOM or draft-store code.
 * [OUTPUT]: RemoteDraftCheckpointPort (host-implemented encrypted storage), the closed DraftCheckpoint (with frozen queued sends and original cancellation custody) / CheckpointFile shapes, parseCheckpoint and blobKey. Full queued settings, complete recovery identities and immutable queue-operation journals survive reload.
 * [POS]: DOM-free half of the W23 recovery contract, so platform contracts (also compiled into the desktop main process) never pull the draft store or canvas code; checkpoint.ts adds the binder.
 */
import { z } from "zod";
import { pluginSourceMetadataSchema, pluginSourceSchema } from "@bottega/contracts/plugins/surface/source";
import { remoteAttachmentSchema, remotePermissionModeSchema } from "@ai-chat/cloud-protocol/remote/input/model";
import { remoteFileReferenceSchema, remoteSkillReferenceSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import { remoteCommandInputSchema, remoteCreationReceiptSchema, remoteTurnOptionsSchema } from "@ai-chat/cloud-protocol/remote/model";
import { frozenRemoteCommandSchema, frozenRemoteCreationSchema, remoteCreationInputSchema } from "@ai-chat/cloud-protocol/remote/encrypted";
import { LOCAL_QUEUE_LIMIT, DRAFT_CUSTODY_LIMIT } from "./limits";
/** Host storage for one account and encrypted space. Blobs are immutable per key, so a host may skip re-encrypting a key it already holds. */
export interface RemoteDraftCheckpointPort {
  read(key: string): Promise<{ checkpoint: unknown; blobs: ReadonlyMap<string, Blob> } | null>;
  write(key: string, checkpoint: DraftCheckpoint, blobs: ReadonlyMap<string, Blob>): Promise<void>;
  remove(key: string): Promise<void>;
  /** Called before the key's session ends (a biometric pause); the returned function unregisters. Optional per host. */
  beforeEnd?(settle: () => Promise<void>): () => void;
}
const positionSchema = z.object({ afterCommandId: z.string().optional(), afterTurnId: z.string().optional() }).strict();
const uuid = z.string().uuid();
const queueIdentity = z.string().min(1).max(256);
const settingsSchema = z.object({ backend: remoteCreationInputSchema.shape.backend, permissionMode: remotePermissionModeSchema, options: remoteTurnOptionsSchema.optional() }).strict();
const referenceSchema = z.object({ id: z.string().min(1).max(256), label: z.string().max(1024),
  value: z.discriminatedUnion("kind", [remoteFileReferenceSchema, remoteSkillReferenceSchema]) }).strict();
/* processed: the fixed File is held; source: the picked image is held and is processed again; reselect: nothing is held. */
const storedPluginSourceSchema = pluginSourceMetadataSchema.extend({ encoding: z.literal("chunks"),
  parts: z.array(z.string().min(1).max(256)).min(1).max(6) }).strict();
const fileSchema = z.object({ id: uuid, uploadId: uuid, name: z.string().min(1).max(1024), mime: z.string().max(255), image: z.boolean(),
  sketch: z.unknown().optional(), pluginSource: z.union([pluginSourceSchema, storedPluginSourceSchema]).optional(), attachment: remoteAttachmentSchema.optional(), readyAt: z.number().int().nonnegative().optional(), kind: z.enum(["processed", "source", "reselect"]) }).strict();
const checkpointSchema = z.object({ version: z.literal(1), text: z.string().max(1_048_576), retainedText: z.string().max(1_048_576).nullable(),
  references: z.array(referenceSchema).max(32), permissionMode: remotePermissionModeSchema.nullable(), planMode: z.boolean(),
  options: z.object({ backend: z.string().min(1).max(64), model: z.string().max(256).optional(), reasoningEffort: z.string().max(256).optional(), serviceTier: z.string().max(256).optional() }).strict().nullable(),
  dismissedPlans: z.array(z.string().max(256)).max(64), files: z.array(fileSchema).max(8),
  creation: z.object({ input: remoteCreationInputSchema, commandId: uuid, text: z.string().max(1_048_576), permissionMode: remotePermissionModeSchema, planMode: z.boolean(),
    options: remoteTurnOptionsSchema.optional(), references: z.array(referenceSchema.shape.value).max(32).optional(), frozen: frozenRemoteCreationSchema.optional(),
    receipt: remoteCreationReceiptSchema.optional(), commandStarted: z.boolean().optional() }).strict().nullable(),
  submitted: z.array(z.object({ commandId: queueIdentity, text: z.string().max(1_048_576), references: z.array(referenceSchema).max(32), files: z.array(fileSchema).max(8), settings: settingsSchema.optional(), planMode: z.boolean().optional(), settlementId: queueIdentity.optional() }).strict()).max(DRAFT_CUSTODY_LIMIT),
  commands: z.array(z.object({ input: remoteCommandInputSchema, frozen: frozenRemoteCommandSchema.optional(), position: positionSchema.optional(), stopRequested: z.boolean().optional(), cancelCommandId: uuid.optional(), pauseQueue: z.boolean().optional() }).strict()).max(DRAFT_CUSTODY_LIMIT),
  recoveries: z.array(queueIdentity).max(DRAFT_CUSTODY_LIMIT).optional(),
  queueOperations: z.array(z.object({ input: remoteCommandInputSchema, kind: z.enum(["edit", "steer", "remove", "control", "admit"]), originalId: queueIdentity.optional(), draftVersion: z.number().int(), replacement: z.boolean().optional() }).strict()).max(1).optional(),
  /* Held messages retain their submitted settings and predecessor across reload. */
  local: z.object({ items: z.array(z.object({ commandId: uuid, text: z.string().max(1_048_576), attachments: z.array(remoteAttachmentSchema).max(8),
    references: z.array(referenceSchema.shape.value).max(32), planMode: z.boolean(), incarnationId: z.string().min(1).max(256), ownerDeviceId: z.string().min(1).max(256), position: positionSchema.optional(),
    settings: settingsSchema.optional() }).strict()).max(LOCAL_QUEUE_LIMIT),
    gate: uuid.nullable(), paused: z.string().min(1).max(256).nullable() }).strict().optional(),
}).strict();
export type DraftCheckpoint = z.infer<typeof checkpointSchema>;
export type CheckpointFile = z.infer<typeof fileSchema>;
export const parseCheckpoint = (value: unknown) => {
  // Retired local-only waiting flags must not invalidate an otherwise valid saved draft.
  if (value && typeof value === "object" && "stoppedWaiting" in value) {
    const { stoppedWaiting: _retired, ...saved } = value;
    return checkpointSchema.parse(saved);
  }
  return checkpointSchema.parse(value);
};
export const blobKey = (file: Pick<CheckpointFile, "id" | "kind">) => `${file.id}.${file.kind === "source" ? "source" : "file"}`;
