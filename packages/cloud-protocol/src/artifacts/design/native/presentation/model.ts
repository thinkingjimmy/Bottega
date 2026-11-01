/**
 * [INPUT]: Untrusted trusted-host presentation intents and exact native slide/session identities.
 * [OUTPUT]: Closed bounded presentation controls and truthful desktop/inline/fullscreen state metadata.
 * [POS]: Shared native presentation boundary; no URL, window, owner or filesystem authority is accepted.
 */
import { z } from "zod";
import { utf8JsonBytes } from "../../canvas/commands";
const slideId = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,127}$/), sessionId = z.string().uuid();
export const nativePresentationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), slideId, notes: z.boolean() }).strict(),
  ...["status", "notes", "exit"].map(action => z.object({ action: z.literal(action as "status" | "notes" | "exit"), sessionId }).strict()),
  ...["navigate", "changed"].map(action => z.object({ action: z.literal(action as "navigate" | "changed"), sessionId, slideId }).strict()),
]).refine(value => utf8JsonBytes(value) <= 8192, "The complete presentation control exceeds 8 KiB");
export type NativePresentationCommand = z.infer<typeof nativePresentationCommandSchema>;
export type NativePresentationState = { sessionId: string; mode: "desktop" | "inline"; slideId: string; fullscreen: boolean; notesOpen: boolean; closed: boolean; reason?: string };
export type NativePresentationRole = { sessionId: string; slideId: string };
