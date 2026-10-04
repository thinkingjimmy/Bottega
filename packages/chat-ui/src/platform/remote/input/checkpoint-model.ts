/**
 * [INPUT]: Depends on opaque plugin source metadata and closed remote attachment, reference, creation and command schemas; no DOM or draft-store code.
 * [OUTPUT]: RemoteDraftCheckpointPort (host-implemented encrypted storage), the closed DraftCheckpoint (with the ruling 12 local queue and Stop waiting ids) / CheckpointFile shapes, parseCheckpoint and blobKey.
 * [POS]: DOM-free half of the W23 recovery contract, so platform contracts (also compiled into the desktop main process) never pull the draft store or canvas code; checkpoint.ts adds the binder.
 */
import { z } from "zod";
import { pluginSourceMetadataSchema, pluginSourceSchema } from "@bottega/contracts/plugins/surface/source";
import { remoteAttachmentSchema, remotePermissionModeSchema } from "@ai-chat/cloud-protocol/remote/input/model";
import { remoteFileReferenceSchema, remoteSkillReferenceSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import { remoteCommandInputSchema, remoteCreationReceiptSchema, remoteTurnOptionsSchema } from "@ai-chat/cloud-protocol/remote/model";
import { frozenRemoteCommandSchema, frozenRemoteCreationSchema, remoteCreationInputSchema } from "@ai-chat/cloud-protocol/remote/encrypted";
/** Host storage for one account and encrypted space. Blobs are immutable per key, so a host may skip re-encrypting a key it already holds. */
export interface RemoteDraftCheckpointPort {
  read(key: string): Promise<{ checkpoint: unknown; blobs: ReadonlyMap<string, Blob> } | null>;
  write(key: string, checkpoint: DraftCheckpoint, blobs: ReadonlyMap<string, Blob>): Promise<void>;
  remove(key: string): Promise<void>;
  /** Called before the key's session ends (a biometric pause); the returned function unregisters. Optional per host. */
  beforeEnd?(settle: () => Promise<void>): () => void;
}
const uuid = z.string().uuid();
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
    receipt: remoteCreationReceiptSchema.optional() }).strict().nullable(),
  submitted: z.array(z.object({ commandId: uuid, text: z.string().max(1_048_576), references: z.array(referenceSchema).max(32), files: z.array(fileSchema).max(8) }).strict()).max(16),
  commands: z.array(z.object({ input: remoteCommandInputSchema, frozen: frozenRemoteCommandSchema.optional() }).strict()).max(16),
  /* Ruling 12: this controller's held messages and the commands it stopped waiting for (ids leave once terminal). */
  local: z.object({ items: z.array(z.object({ commandId: uuid, text: z.string().max(1_048_576), attachments: z.array(remoteAttachmentSchema).max(8),
    references: z.array(referenceSchema.shape.value).max(32), planMode: z.boolean(), incarnationId: z.string().min(1).max(256), ownerDeviceId: z.string().min(1).max(256) }).strict()).max(20),
    gate: uuid.nullable(), paused: z.string().min(1).max(256).nullable() }).strict().optional(),
  stoppedWaiting: z.array(uuid).max(64).optional(),
}).strict();
export type DraftCheckpoint = z.infer<typeof checkpointSchema>;
export type CheckpointFile = z.infer<typeof fileSchema>;
export const parseCheckpoint = (value: unknown) => checkpointSchema.parse(value);
export const blobKey = (file: Pick<CheckpointFile, "id" | "kind">) => `${file.id}.${file.kind === "source" ? "source" : "file"}`;
