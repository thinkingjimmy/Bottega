/**
 * [INPUT]: Depends on canonical public option schemas, the bounded Provider id and shared Agent option types
 * [OUTPUT]: Provides the exact option schema, factory defaults, pure default resolution, and the user provider-order normalizer; and
 *           TASK-11 S3-b's Chat-side widening: ChatAgentId, builtinAgent / builtinOptions (the one narrowing back to a built-in), chatSyncExclusion (the one reason a Chat stays local-only), packageTurnOptionsSchema / PackageTurnOptions (the one shape a package
 *           Provider's turn options take) and chatTurnOptionsSchema / ChatTurnOptions (a built-in id only in its built-in shape)
 * [POS]: Shared Chat option authority; persistence remains owned by SQLite and Settings. The cloud-protocol schemas it re-exports stay
 *        closed: a package Provider's Chat never leaves this computer this period
 */

import { AGENT_BACKEND_ORDER, type AgentBackendId, type AgentTurnOptions, type CodexTurnOptions } from "../ipc/agent/agent-ipc";
import type { DefaultChatOptionsByBackend } from "../ipc/settings/settings-ipc";

export { turnOptionsSchema, defaultsSchema } from "@ai-chat/cloud-protocol/chats/options";
import { agentBackendIdSchema, turnOptionsSchema } from "@ai-chat/cloud-protocol/chats/options";
import { providerIdSchema, type ProviderId } from "@ai-chat/cloud-protocol/contracts/provider-id-schema";
import { z } from "zod";

/** The Agent a Chat record names (its `agent`, `session.backend`, each reply's `backend`): a built-in or a package Provider's id. */
export type ChatAgentId = ProviderId;
export const chatAgentIdSchema = providerIdSchema;

/** A package Provider's turn options: what a DescriptorBackend admits (ask-for-approval only, a listed model), nothing else. */
export const packageTurnOptionsSchema = z.object({
  backend: providerIdSchema.refine(id => !agentBackendIdSchema.safeParse(id).success, "a built-in Provider takes its own options"),
  permissionMode: z.literal("ask-for-approval"),
  model: z.string().regex(/^[A-Za-z0-9._:/@+-]{1,128}$/).optional(),
}).strict();
export type PackageTurnOptions = z.infer<typeof packageTurnOptionsSchema>;

/** A Chat's options: a built-in id only ever in its built-in shape, a package id only in the package shape. */
export const chatTurnOptionsSchema = z.union([turnOptionsSchema, packageTurnOptionsSchema]);
export type ChatTurnOptions = AgentTurnOptions | PackageTurnOptions;

/** The built-in behind a Chat's Agent, or null for a package Provider's: the Chat side's one narrowing, never a cast. */
export function builtinAgent(id: ChatAgentId): AgentBackendId | null {
  const builtin = agentBackendIdSchema.safeParse(id);
  return builtin.success ? builtin.data : null;
}
/** Why a Chat never leaves this computer this period, or null: a package Provider's Chat stays local (TASK-11 S3-b). Sync enrollment,
    the initial snapshot and the library mirror all read this one predicate; the wire formats stay closed until S5–S7. */
export type ChatSyncExclusion = "package-provider";
export function chatSyncExclusion(chat: Readonly<{ agent: ChatAgentId }>): ChatSyncExclusion | null {
  return builtinAgent(chat.agent) ? null : "package-provider";
}

/** A Chat's options when its Agent is a built-in, else null. */
export function builtinOptions(options: ChatTurnOptions): AgentTurnOptions | null {
  const builtin = turnOptionsSchema.safeParse(options);
  return builtin.success ? builtin.data : null;
}

export const DEFAULT_CHAT_OPTIONS: CodexTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};
export const DEFAULT_CHAT_OPTIONS_BY_BACKEND: DefaultChatOptionsByBackend = {
  codex: DEFAULT_CHAT_OPTIONS,
  claude: { backend: "claude", permissionMode: "ask-for-approval" },
  kimi: { backend: "kimi", permissionMode: "ask-for-approval" },
  opencode: { backend: "opencode", permissionMode: "ask-for-approval" },
};

export function backendDefaults(defaults: DefaultChatOptionsByBackend, backend: AgentBackendId): AgentTurnOptions;
export function backendDefaults(defaults: DefaultChatOptionsByBackend, backend: ChatAgentId): ChatTurnOptions;
/** A package Provider starts from the only options it admits (S3-b R9); a built-in from the user's or the factory defaults. */
export function backendDefaults(defaults: DefaultChatOptionsByBackend, backend: ChatAgentId): ChatTurnOptions {
  const builtin = agentBackendIdSchema.safeParse(backend);
  if (!builtin.success) return packageTurnOptionsSchema.parse({ backend, permissionMode: "ask-for-approval" });
  return structuredClone(turnOptionsSchema.parse(defaults[builtin.data] ?? DEFAULT_CHAT_OPTIONS_BY_BACKEND[builtin.data]));
}

/** The user's picker order: persisted ids first (deduplicated), then any backend the file predates. */
export function normalizeProviderOrder(order: readonly AgentBackendId[]): AgentBackendId[] {
  const known = new Set<AgentBackendId>();
  for (const id of order) if (AGENT_BACKEND_ORDER.includes(id)) known.add(id);
  for (const id of AGENT_BACKEND_ORDER) known.add(id);
  return [...known];
}
