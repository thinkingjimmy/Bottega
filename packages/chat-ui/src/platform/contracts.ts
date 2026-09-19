/**
 * [INPUT]: Depends on portable identity, account/device, Chat body, read models and closed remote command/executor contracts.
 * [OUTPUT]: Exposes six platform facades, explicit feature capabilities, optional verified-head reuse for page reads, an optional prepared imported-body port and attachment-aware remote control capabilities.
 * [POS]: SDK-free boundary; clients own subscriptions, execution, credentials and binary access.
 */
import type { z } from "zod";
import type { accountProfileSchema, CloudFunctionResult, BlobDescriptor } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatCatalogPage, ChatLiveView, TranscriptPage, TranscriptRequest } from "./model";
import type { PreparedImportedField } from "./transcript/fields";
import type { RemoteCommandPort, RemoteExecutorPort } from "./remote/contracts";
export type { PreparedImportedField };
export type Unsubscribe = () => void;
export type AccountSnapshot = { state: "signed-out" | "ready" | "offline" | "blocked"; profile: z.infer<typeof accountProfileSchema> | null; deviceId: string | null };
export interface AccountFacade {
  snapshot(): AccountSnapshot;
  subscribe(changed: () => void): Unsubscribe;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  devices(cursor: string | null): Promise<CloudFunctionResult<"devices:list">>;
}
export interface ChatListSource {
  browse(input: { projectId: string | null; rootOnly?: boolean; archived: boolean; cursor: string | null; revision: number | null }, signal: AbortSignal): Promise<import("./read-source").ChatQueryResult<"chats/catalog:page">>;
  page(input: { afterRevision: number; throughRevision: number | null }, signal: AbortSignal): Promise<ChatCatalogPage>;
  head(chatId: string, signal: AbortSignal): Promise<CloudChatHead | null>;
  subscribe(changed: (revision?: number) => void, failed: (error: unknown) => void): Unsubscribe;
}
export interface TranscriptSource {
  page(input: TranscriptRequest, signal: AbortSignal, head?: CloudChatHead): Promise<TranscriptPage>;
  /** Content-addressed imported bodies survive sessions where a page cannot: hosts with no plaintext cache omit the port. */
  preview?(chatId: string, head: CloudChatHead, signal: AbortSignal): Promise<{ native: TranscriptPage; imported?: TranscriptPage } | undefined>;
  prepared?: { get(key: string): PreparedImportedField | undefined | Promise<PreparedImportedField | undefined>; set(key: string, value: PreparedImportedField): void };
  locate?(chatId: string, messageId: string, signal: AbortSignal): Promise<{ segment: "native" | "imported"; seq: number } | null>;
  subscribe(chatId: string, changed: () => void, failed: (error: unknown) => void): Unsubscribe;
  file(chatId: string, descriptor: BlobDescriptor, signal: AbortSignal): Promise<{ url: string; release(): void }>;
}
export interface LiveTurnSource {
  attach(chatId: string, changed: (value: ChatLiveView) => void, failed: (error: unknown) => void): Unsubscribe;
}
interface ChatCommandActions {
  start(input: { chatId: string; requestId: string; text: string; attachmentIds: string[] }): Promise<void>;
  cancel(chatId: string, requestId: string): Promise<void>;
  steer(chatId: string, requestId: string, text: string): Promise<void>;
  respond(chatId: string, requestId: string, interactionId: string, response: { choice?: string; values?: Record<string, string[]> }): Promise<void>;
}
type CommandActions = Record<"start" | "cancel" | "steer" | "respond", (...args: never[]) => unknown>;
// Native admission keeps its frozen rich submission and original receipt; a facade must not recompile either.
export type CommandSink<Actions extends CommandActions = ChatCommandActions> = Actions & { available(chatId: string): boolean; remote?: RemoteCommandPort };
export const readonlyCommands: CommandSink = Object.freeze({ available: () => false,
  start: async () => { throw new Error("CHAT_COMMANDS_UNAVAILABLE"); }, cancel: async () => { throw new Error("CHAT_COMMANDS_UNAVAILABLE"); },
  steer: async () => { throw new Error("CHAT_COMMANDS_UNAVAILABLE"); }, respond: async () => { throw new Error("CHAT_COMMANDS_UNAVAILABLE"); } });
export type { ExecutionView, ExecutionReason } from "./execution";
export { executionViewSchema } from "./execution";
import type { ExecutionView } from "./execution";
export interface ExecutorFacade {
  remote?: RemoteExecutorPort;
  read(chatId: string): Promise<ExecutionView>;
  subscribe(chatId: string, changed: () => void): Unsubscribe;
  claim(chatId: string): Promise<void>;
  prepare(chatId: string): Promise<void>;
}
export type ChatCapabilities = Readonly<Record<"files" | "skills" | "queue" | "browser" | "apps" | "recovery" | "serviceTier" | "quota" | "find" | "outline", boolean>>;
export const LOCAL_CHAT_CAPABILITIES: ChatCapabilities = Object.freeze({ files: true, skills: true, queue: true, browser: true, apps: true, recovery: true, serviceTier: true, quota: true, find: true, outline: true });
export const CLOUD_CHAT_CAPABILITIES: ChatCapabilities = Object.freeze({ ...LOCAL_CHAT_CAPABILITIES, browser: false, apps: false });
/** Facades keep transport-native evidence types; presentation adapters normalize views, never execution authority. */
export type ChatPlatformFacades<Account, Chats, Transcript, Live, Commands, Executor> = {
  capabilities: ChatCapabilities; account: Account; chats: Chats; transcript: Transcript; live: Live; commands: Commands; executor: Executor;
};
export type ChatPlatform<Actions extends CommandActions = ChatCommandActions> =
  ChatPlatformFacades<AccountFacade, ChatListSource, TranscriptSource, LiveTurnSource, CommandSink<Actions>, ExecutorFacade> & {
    skills?: import("./remote/workspace").SkillSource;
  };
