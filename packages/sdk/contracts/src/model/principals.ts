/**
 * [INPUT]: Depends on Zod, ChatRef and the protocol opaque-id scalar.
 * [OUTPUT]: Provides PRINCIPAL_KINDS, PrincipalKind, principalSchema, Principal, principalKey.
 * [POS]: Wire form of an identity the host has already verified; a principal is never accepted from a caller-supplied name or runId, only produced by the host from a checked channel.
 */
import { z } from "zod";
import { id } from "../core/scalars";
import { chatRefSchema } from "./resources";

export const PRINCIPAL_KINDS = ["user-device", "agent-turn", "app-surface"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const principalSchema = z.discriminatedUnion("kind", [
  /** A trusted renderer of this installation, bound to its renderer incarnation. */
  z.object({ kind: z.literal("user-device"), deviceId: id, rendererIncarnation: id }).strict(),
  /** One Agent turn: its Chat, the turn request id and the host lease that carries it. */
  z.object({ kind: z.literal("agent-turn"), chat: chatRefSchema, turnId: id, leaseId: id }).strict(),
  /** One App surface: the App generation and the surface lease the host issued for it. */
  z.object({ kind: z.literal("app-surface"), appId: id, generationId: id, surfaceLeaseId: id }).strict(),
]);
export type Principal = z.infer<typeof principalSchema>;

export function principalKey(principal: Principal): string {
  switch (principal.kind) {
    case "user-device": return `user-device:${principal.deviceId}:${principal.rendererIncarnation}`;
    case "agent-turn": return `agent-turn:${principal.chat.chatId}:${principal.chat.incarnationId}:${principal.turnId}:${principal.leaseId}`;
    case "app-surface": return `app-surface:${principal.appId}:${principal.generationId}:${principal.surfaceLeaseId}`;
  }
}
