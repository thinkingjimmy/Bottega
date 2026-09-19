/**
 * [INPUT]: Depends on the public Chat registry, transcript models and closed local continuation contracts.
 * [OUTPUT]: Defines fixed-purpose Chat facts/deletion, Project deletion review, retained catalogs, file reading and continuation IPC.
 * [POS]: Trusted renderer boundary; account scopes and file paths remain main-owned.
 */
import { z } from "zod";
import { cloudIdSchema as id, cloudFunctions } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { transcriptRequestSchema, type ChatCatalogPage, type TranscriptPage, type TranscriptRequest } from "@ai-chat/chat-ui/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ExecutionView } from "@ai-chat/chat-ui/contracts";
import type { ExecutionDraft } from "./execution";
import type { RecoveryIdentity, RecoveryPage, RetainedCatalog, RetainedMetadata } from "./recovery";
import type { BlobDescriptor } from "@ai-chat/cloud-protocol";
import type { ChatQueryInput, ChatQueryName, ChatQueryResult } from "@ai-chat/chat-ui/read-source";
import type { ChatFactsView, ChatFactsEdit, ChatFactsDecision } from "./facts";
import type { ChatDeletionView, ChatDeletionRequest, ChatDeletionKeep } from "./deletion";
import type { ProjectDeletionCatalog, ProjectDeletionReview, ProjectDeletionDecision } from "./projects/deletion";
const chatReadNames = ["chats/metadata:head", "chats/metadata:catalog", "chats/metadata:page", "chats/catalog:page", "chats/body/reads:head",
  "chats/body/reads:page", "chats/body/reads:get", "chats/body/reads:block", "chats/imported/reads:head", "chats/imported/reads:page", "turns/reads:state", "turns/reads:page"] as const;
export const chatReadSchema = z.object({ name: z.enum(chatReadNames), input: z.unknown() }).strict();
export const chatWatchSchema = chatReadSchema.extend({ subscriptionId: z.string().uuid() }).strict();
export const chatCatalogRequestSchema = z.object({ afterRevision: z.number().int().nonnegative(), throughRevision: z.number().int().nonnegative().nullable() }).strict();
export const chatFileOpenSchema = z.object({ chatId: id, descriptor: encryptedFileDescriptorSchema }).strict();
export const chatFileReadSchema = z.object({ leaseId: z.string().uuid(), offset: z.number().int().nonnegative().safe(), length: z.number().int().positive().max(1024 * 1024) }).strict();
export const chatIdRequestSchema = z.object({ chatId: id }).strict();
export const CHAT_CHANNEL = { catalog: "cloud-chat:catalog", head: "cloud-chat:head", transcript: "cloud-chat:transcript", query: "cloud-chat:query",
  facts: "cloud-chat:facts", editFacts: "cloud-chat:edit-facts", resolveFacts: "cloud-chat:resolve-facts",
  deletion: "cloud-chat:deletion", requestDeletion: "cloud-chat:request-deletion", keepDeletion: "cloud-chat:keep-deletion",
  watch: "cloud-chat:watch", unwatch: "cloud-chat:unwatch", changed: "cloud-chat:changed", openFile: "cloud-chat:open-file",
  readFile: "cloud-chat:read-file", closeFile: "cloud-chat:close-file", execution: "cloud-chat:execution", claim: "cloud-chat:claim", prepare: "cloud-chat:prepare",
  draft: "cloud-chat:draft", saveDraft: "cloud-chat:save-draft", bindProject: "cloud-chat:bind-project",
  retainedCatalog: "cloud-chat:retained-catalog", retainedMetadata: "cloud-chat:retained-metadata",
  projectDeletionCatalog: "cloud-chat:project-deletion-catalog", reviewProjectDeletion: "cloud-chat:project-deletion-review", resolveProjectDeletion: "cloud-chat:project-deletion-resolve", retryProjectDeletion: "cloud-chat:project-deletion-retry",
  recoveryPage: "cloud-chat:recovery-page", recoveryFile: "cloud-chat:recovery-file" } as const;
export interface CloudChatBridge {
  deletion(input: { chatId: string }): Promise<ChatDeletionView>;
  requestDeletion(input: ChatDeletionRequest): Promise<ChatDeletionView>;
  keepDeletion(input: ChatDeletionKeep): Promise<ChatDeletionView>;
  facts(input: { chatId: string }): Promise<ChatFactsView>;
  editFacts(input: ChatFactsEdit): Promise<ChatFactsView>;
  resolveFacts(input: ChatFactsDecision): Promise<ChatFactsView>;
  retainedCatalog(input: { afterId: string | null }): Promise<RetainedCatalog>;
  retainedMetadata(input: RecoveryIdentity & { before: number | null }): Promise<RetainedMetadata>;
  projectDeletionCatalog(input: { afterId: string | null }): Promise<ProjectDeletionCatalog>;
  reviewProjectDeletion(input: { projectId: string }): Promise<ProjectDeletionReview>;
  resolveProjectDeletion(input: ProjectDeletionDecision): Promise<void>;
  retryProjectDeletion(input: { projectId: string }): Promise<void>;
  recoveryPage(input: RecoveryIdentity & { before: number | null }): Promise<RecoveryPage>;
  recoveryFile(input: RecoveryIdentity & { messageId: string; descriptor: BlobDescriptor }): Promise<{ leaseId: string }>;
  onLocalChanged(changed: () => void): () => void;
  catalog(input: z.infer<typeof chatCatalogRequestSchema>): Promise<ChatCatalogPage>;
  head(input: { chatId: string }): Promise<CloudChatHead | null>;
  execution(input: { chatId: string }): Promise<ExecutionView>;
  claim(input: { chatId: string }): Promise<void>;
  prepare(input: { chatId: string }): Promise<void>;
  bindProject(input: { chatId: string }): Promise<boolean>;
  draft(input: { chatId: string; incarnationId: string }): Promise<ExecutionDraft>;
  saveDraft(input: { chatId: string; incarnationId: string; expectedRevision: number; text: string }): Promise<ExecutionDraft>;
  transcript(input: TranscriptRequest): Promise<TranscriptPage>;
  query<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>): Promise<ChatQueryResult<N>>;
  watch<N extends ChatQueryName>(name: N, input: ChatQueryInput<N>, changed: (value: ChatQueryResult<N>) => void, failed: () => void): () => void;
  openFile(input: z.infer<typeof chatFileOpenSchema>): Promise<{ leaseId: string }>;
  readFile(input: z.infer<typeof chatFileReadSchema>): Promise<Uint8Array>;
  closeFile(input: { leaseId: string }): Promise<void>;
}
export { transcriptRequestSchema, cloudFunctions };
