/**
 * [INPUT]: Depends on closed cloud command, target, preparation and creation DTOs and the shared unsubscribe type.
 * [OUTPUT]: Defines complete remote command, creation, preparation and attachment staging ports across Web and desktop; no port moves a chat between computers.
 * [POS]: Six-facade extension; native admission retains its original strict input and receipt types.
 */
import type { CloudFunctionArgs } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteCommandInput as PlainInput, RemoteCommandReceipt, RemoteCreationReceipt, RemoteTargets as PlainTargets } from "@ai-chat/cloud-protocol/remote/model";
import type { FrozenRemoteCommand, FrozenRemoteCreation, RemoteCreationInput } from "@ai-chat/cloud-protocol/remote/encrypted";
import type { RemoteAdmissionRejected } from "@ai-chat/cloud-protocol/remote/selection";
import type { Unsubscribe } from "../contracts";
type Header = "environmentId" | "deploymentId" | "protocolVersion" | "expectedUserId" | "encryptedSpace";
export type RemoteCommandInput = PlainInput;
export type RemoteCommand = RemoteCommandReceipt;
type RemoteCommandPage = { items: RemoteCommandReceipt[]; cursor: string | null; complete: boolean; serverTime: number };
type RemoteTargetInput = Omit<CloudFunctionArgs<"remote/capabilities:targets">, Header>;
type RemoteTargetPage = PlainTargets;
export type RemoteTargets = RemoteTargetPage & { localDeviceId: string | null };
export type RemoteCreateInput = RemoteCreationInput;
export type RemoteCreated = RemoteCreationReceipt;
export type RemotePreparationInput = Omit<CloudFunctionArgs<"remote/chats:retryPreparation">, Header>;
export interface RemoteCommandPort {
  queue?: {
    watch(chatId: string, changed: (value: import("@ai-chat/cloud-protocol/remote/queue").AwaitingQueue) => void, failed: (error: unknown) => void): Unsubscribe;
    reorder(input: Omit<CloudFunctionArgs<"remote/queue:reorderAwaiting">, Header>): Promise<null>;
  };
  attachments?: import("./input/upload").RemoteAttachmentPort;
  cacheScope?: object;
  lifetime?: AbortSignal;
  prepare(command: RemoteCommandInput): Promise<FrozenRemoteCommand>;
  submit(command: RemoteCommandInput, frozen: FrozenRemoteCommand): Promise<RemoteCommand | RemoteAdmissionRejected>;
  withdraw?(commandId: string): Promise<RemoteCommand>;
  get(commandId: string): Promise<RemoteCommand | null>;
  page(chatId: string, cursor: string | null): Promise<RemoteCommandPage>;
  watch(commandId: string, changed: (value: RemoteCommand | null) => void, failed: (error: unknown) => void): Unsubscribe;
  watchPage(chatId: string, cursor: string | null, changed: (value: RemoteCommandPage) => void, failed: (error: unknown) => void): Unsubscribe;
}
export interface RemoteExecutionPort {
  projectFiles?(input: { targetDeviceId: string; projectId: string; query: string }, signal: AbortSignal): Promise<import("@ai-chat/cloud-protocol/remote/input/references").RemoteWorkspaceResult & { kind: "workspace-files" }>;

  targets(input: RemoteTargetInput): Promise<RemoteTargets>;
  watchTargets(input: RemoteTargetInput, changed: (value: RemoteTargets) => void, failed: (error: unknown) => void): Unsubscribe;
  prepareCreate(input: RemoteCreateInput): Promise<FrozenRemoteCreation>;
  create(input: RemoteCreateInput, frozen: FrozenRemoteCreation): Promise<RemoteCreated | RemoteAdmissionRejected>;
  created(createOperationId: string): Promise<RemoteCreated | null>;
  retryPreparation(input: RemotePreparationInput): Promise<CloudChatHead>;
}
