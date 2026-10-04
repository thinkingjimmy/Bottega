/**
 * [INPUT]: Depends on closed remote requests (the remote function table only, never the whole registry, which would enter the preload), preparation contracts and strict preparation/admission rejection codes.
 * [OUTPUT]: Defines strict remote IPC including mixed attachment staging, cancellation and progress.
 * [POS]: Shared main/preload boundary; authentication, connection epochs and local execution authority stay in main.
 */
import { projectQueryInputSchema } from "@ai-chat/cloud-protocol/remote/workspace/model";
import { remoteWorkspaceListSchema } from "@ai-chat/cloud-protocol/remote/input/references";
import { z } from "zod";
import { remoteFunctions } from "@ai-chat/cloud-protocol/remote/functions";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { frozenRemoteCommandSchema, frozenRemoteCreationSchema, remoteCreationInputSchema } from "@ai-chat/cloud-protocol/remote/encrypted";
import { remoteCommandInputSchema, remoteTargetsSchema, remoteReceiptSchema, remoteCreationReceiptSchema } from "@ai-chat/cloud-protocol/remote/model";
import { preparationRejectionSchema, remoteAdmissionRejectionSchema } from "@ai-chat/cloud-protocol/remote/selection";
import { remoteAttachmentSchema, REMOTE_ATTACHMENT_BYTES } from "@ai-chat/cloud-protocol/remote/input/model";
const omit = { protocolVersion: true, environmentId: true, deploymentId: true, expectedUserId: true, encryptedSpace: true } as const;
const preparationRejection = z.object({ rejected: preparationRejectionSchema }).strict();
const admissionRejection = z.object({ rejected: remoteAdmissionRejectionSchema }).strict();
export const remoteAttachmentProgressSchema = z.object({ uploadId: z.string().uuid(), progress: z.object({
  phase: z.enum(["hashing", "uploading", "verifying", "downloading"]), bytes: z.number().nonnegative(), total: z.number().nonnegative(),
}).strict() }).strict();
export const remoteRequests = {
  projectFiles: projectQueryInputSchema,
  queue: remoteFunctions["remote/queue:awaiting"].args.omit(omit),
  reorderQueue: remoteFunctions["remote/queue:reorderAwaiting"].args.omit(omit),
  stageAttachment: z.object({ chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), attachmentId: z.string().uuid(), uploadId: z.string().uuid(),
    filename: z.string().min(1).max(255), mediaType: z.string().max(255), bytes: z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= REMOTE_ATTACHMENT_BYTES) }).strict(),
  cancelAttachment: z.object({ uploadId: z.string().uuid() }).strict(),
  targets: remoteFunctions["remote/capabilities:targets"].args.omit(omit),
  prepareCommand: remoteCommandInputSchema,
  submit: z.object({ command: remoteCommandInputSchema, frozen: frozenRemoteCommandSchema }).strict(),
  withdraw: remoteFunctions["remote/commands:withdraw"].args.omit(omit),
  command: remoteFunctions["remote/commands:get"].args.omit(omit),
  commands: remoteFunctions["remote/commands:page"].args.omit(omit),
  receipts: remoteFunctions["remote/commands:receipts"].args.omit(omit),
  prepareCreate: remoteCreationInputSchema,
  create: z.object({ input: remoteCreationInputSchema, frozen: frozenRemoteCreationSchema }).strict(),
  created: remoteFunctions["remote/chats:created"].args.omit(omit),
  retryPreparation: remoteFunctions["remote/chats:retryPreparation"].args.omit(omit),
} as const;
export const remoteResults = {
  projectFiles: remoteWorkspaceListSchema,
  queue: remoteFunctions["remote/queue:awaiting"].result,
  reorderQueue: z.null(),
  stageAttachment: remoteAttachmentSchema,
  cancelAttachment: z.null(),
  targets: remoteTargetsSchema.extend({ localDeviceId: z.string().nullable() }),
  prepareCommand: frozenRemoteCommandSchema,
  submit: z.union([remoteReceiptSchema, admissionRejection]),
  withdraw: remoteReceiptSchema,
  command: remoteReceiptSchema.nullable(),
  commands: z.object({ items: z.array(remoteReceiptSchema), cursor: z.string().nullable(), complete: z.boolean(), serverTime: z.number() }).strict(),
  receipts: z.array(remoteReceiptSchema),
  prepareCreate: frozenRemoteCreationSchema,
  create: z.union([remoteCreationReceiptSchema, admissionRejection]),
  created: remoteCreationReceiptSchema.nullable(),
  retryPreparation: z.union([cloudChatHeadSchema, preparationRejection]),
} as const;
export type RemoteMethod = keyof typeof remoteRequests;
export type RemoteInput<N extends RemoteMethod> = z.infer<(typeof remoteRequests)[N]>;
export type RemoteResult<N extends RemoteMethod> = z.infer<(typeof remoteResults)[N]>;
export type RemoteWatch = "queue" | "targets" | "receipts" | "commands";
/* 订阅的受理答复。未登录时这里曾直接抛 REMOTE_ACCOUNT_UNAVAILABLE，
   而 Electron 的默认打印器把它变成启动期日志里反复出现的一整条堆栈——
   渲染端要的只是「这次订阅没建起来」这一件事实（N-1 / AC-8）。 */
export const remoteWatchResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("watching") }).strict(),
  z.object({ kind: z.literal("signed-out") }).strict(),
]);
export const remoteWatchSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("queue"), input: remoteRequests.queue, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("targets"), input: remoteRequests.targets, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("receipts"), input: remoteRequests.receipts, subscriptionId: z.string().uuid() }).strict(),
  z.object({ method: z.literal("commands"), input: remoteRequests.commands, subscriptionId: z.string().uuid() }).strict(),
]);
type Watch<N extends RemoteWatch> = (input: RemoteInput<N>, changed: (value: RemoteResult<N>) => void, failed: () => void) => () => void;
export type CloudRemoteBridge = { [N in RemoteMethod]: (input: RemoteInput<N>) => Promise<RemoteResult<N>> } & {
  watchAttachmentProgress(uploadId: string, changed: (progress: import("@ai-chat/cloud-protocol").FileProgress) => void): () => void;
  watchQueue: Watch<"queue">;
  watchTargets: Watch<"targets">; watchReceipts: Watch<"receipts">; watchCommands: Watch<"commands">;
};
export { REMOTE_CHANNEL } from "../../ipc-channels/cloud";
