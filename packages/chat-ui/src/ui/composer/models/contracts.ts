/**
 * [INPUT]: Portable Agent choices and host-provided model catalogs.
 * [OUTPUT]: Shared model, effort, speed and effective-session presentation types.
 * [POS]: The composer models surface's vocabulary; providers retain authority over advertised options.
 */
import type { z } from "zod";
import type { turnOptionsSchema } from "@ai-chat/cloud-protocol/chats/options";
export type AgentTurnOptions = z.infer<typeof turnOptionsSchema>;
export type CodexTurnOptions = Extract<AgentTurnOptions, { backend: "codex" }>;
export type BackendModelInfo = { slug: string; displayName: string; isDefault: boolean; defaultReasoningEffort?: string;
  supportedReasoningEfforts?: { effort: string; displayName?: string; description: string; hidden?: boolean }[];
  serviceTiers?: { id: string; displayName: string }[] };
export type CodexModelInfo = BackendModelInfo & Required<Pick<BackendModelInfo, "defaultReasoningEffort" | "supportedReasoningEfforts" | "serviceTiers">>;
export type SessionServiceTierReason = "modelUnsupported" | "backendOff" | "backendOn";
export type SessionServiceTierEffective = Readonly<{ value: string; reason: SessionServiceTierReason; at: number }>;
