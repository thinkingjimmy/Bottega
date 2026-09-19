/**
 * [INPUT]: Depends on closed remote requests, executor claim contracts and strict selection/admission rejection codes.
 * [OUTPUT]: Defines strict remote IPC including mixed attachment staging, cancellation and progress.
 * [POS]: Shared main/preload boundary; authentication, connection epochs and local execution authority stay in main.
 */
import { projectQueryInputSchema } from "@ai-chat/cloud-protocol/remote/workspace/model";
import { remoteWorkspaceListSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import { z } from "zod";
import { cloudFunctions } from "@ai-chat/cloud-protocol";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { frozenRemoteCommandSchema, frozenRemoteCreationSchema, remoteCreationInputSchema } from "@ai-chat/cloud-protocol/remote/encrypted";
import { remoteCommandInputSchema, remoteTargetsSchema, remoteReceiptSchema, remoteCreationReceiptSchema } from "@ai-chat/cloud-protocol/remote/model";
import { executorSelectionRejectionSchema, remoteAdmissionRejectionSchema } from "@ai-chat/cloud-protocol/remote/selection";
import { remoteAttachmentSchema, REMOTE_ATTACHMENT_BYTES } from "@ai-chat/cloud-protocol/remote/input/model";
const omit = { protocolVersion: true, environmentId: true, deploymentId: true, expectedUserId: true, encryptedSpace: true } as const;
const executorRejection = z.object({ rejected: executorSelectionRejectionSchema }).strict();
const admissionRejection = z.object({ rejected: remoteAdmissionRejectionSchema }).strict();
export const remoteAttachmentProgressSchema = z.object({ uploadId: z.string().uuid(), progress: z.object({
  phase: z.enum(["hashing", "uploading", "verifying", "downloading"]), bytes: z.number().nonnegative(), total: z.number().nonnegative(),
}).strict() }).strict();
export const remoteRequests = {
  projectFiles: projectQueryInputSchema,
  queue: cloudFunctions["remote/queue:awaiting"].args.omit(omit),
  reorderQueue: cloudFunctions["remote/queue:reorderAwaiting"].args.omit(omit),
  stageAttachment: z.object({ chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), attachmentId: z.string().uuid(), uploadId: z.string().uuid(),
    filename: z.string().min(1).max(255), mediaType: z.string().max(255), bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= REMOTE_ATTACHMENT_BYTES) }).strict(),
  cancelAttachment: z.object({ uploadId: z.string().uuid() }).strict(),
  targets: cloudFunctions["remote/capabilities:targets"].args.omit(omit),
  prepareCommand: remoteCommandInputSchema,
  submit: z.object({ command: remoteCommandInputSchema, frozen: frozenRemoteCommandSchema }).strict(),
  withdraw: cloudFunctions["remote/commands:withdraw"].args.omit(omit),
  command: cloudFunctions["remote/commands:get"].args.omit(omit),
  commands: cloudFunctions["remote/commands:page"].args.omit(omit),
  selectExecutor: cloudFunctions["turns/executor:claim"].args.omit(omit),
  prepareCreate: remoteCreationInputSchema,
  create: z.object({ input: remoteCreationInputSchema, frozen: frozenRemoteCreationSchema }).strict(),
  created: cloudFunctions["remote/chats:created"].args.omit(omit),
  retryPreparation: cloudFunctions["remote/chats:retryPreparation"].args.omit(omit),
} as const;
export const remoteResults = {
  projectFiles: remoteWorkspaceListSchema,
  queue: cloudFunctions["remote/queue:awaiting"].result,
  reorderQueue: z.null(),
  stageAttachment: remoteAttachmentSchema,
  cancelAttachment: z.null(),
  targets: remoteTargetsSchema.extend({ localDeviceId: z.string().nullable() }),
  prepareCommand: frozenRemoteCommandSchema,
  submit: z.union([remoteReceiptSchema, admissionRejection]),
  withdraw: remoteReceiptSchema,
  command: remoteReceiptSchema.nullable(),
  commands: z.object({ items: z.array(remoteReceiptSchema), cursor: z.string().nullable(), complete: z.boolean(), serverTime: z.number() }).strict(),
  selectExecutor: z.union([cloudChatHeadSchema, executorRejection]),
  prepareCreate: frozenRemoteCreationSchema,
  create: z.union([remoteCreationReceiptSchema, admissionRejection]),
  created: remoteCreationReceiptSchema.nullable(),
  retryPreparation: z.union([cloudChatHeadSchema, executorRejection]),
} as const;
export type RemoteMethod = keyof typeof remoteRequests;
export type RemoteInput<N extends RemoteMethod> = z.infer<(typeof remoteRequests)[N]>;
export type RemoteResult<N extends RemoteMethod> = z.infer<(typeof remoteResults)[N]>;
export type RemoteWatch = "queue" | "targets" | "command" | "commands";
export const remoteWatchSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("queue"), input: remoteRequests.queue, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("targets"), input: remoteRequests.targets, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("command"), input: remoteRequests.command, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("commands"), input: remoteRequests.commands, subscriptionId: z.string().uuid() }).strict(),
]);
type Watch<N extends RemoteWatch> = (input: RemoteInput<N>, changed: (value: RemoteResult<N>) => void, failed: () => void) => () => void;
export type CloudRemoteBridge = { [N in RemoteMethod]: (input: RemoteInput<N>) => Promise<RemoteResult<N>> } & {
  watchAttachmentProgress(uploadId: string, changed: (progress: import("@ai-chat/cloud-protocol").FileProgress) => void): () => void;
  watchQueue: Watch<"queue">;
  watchTargets: Watch<"targets">; watchCommand: Watch<"command">; watchCommands: Watch<"commands">;
};
export const REMOTE_CHANNEL = { projectFiles: "cloud-remote:project-files", queue: "cloud-remote:queue", reorderQueue: "cloud-remote:reorder-queue", withdraw: "cloud-remote:withdraw", prepareCommand: "cloud-remote:prepare-command", prepareCreate: "cloud-remote:prepare-create", targets: "cloud-remote:targets", submit: "cloud-remote:submit", command: "cloud-remote:command",
  commands: "cloud-remote:commands", selectExecutor: "cloud-remote:select-executor", create: "cloud-remote:create", created: "cloud-remote:created",
  retryPreparation: "cloud-remote:retry-preparation", watch: "cloud-remote:watch", unwatch: "cloud-remote:unwatch", changed: "cloud-remote:changed",
  stageAttachment: "cloud-remote:stage-attachment", cancelAttachment: "cloud-remote:cancel-attachment", attachmentProgress: "cloud-remote:attachment-progress" } as const;
