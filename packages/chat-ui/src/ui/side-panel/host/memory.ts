/**
 * [INPUT]: Conversation/incarnation identities, current image evidence and optional browser storage.
 * [OUTPUT]: Per-chat page-memory intent, sanitized durable slots and separate normal/artifact widths.
 * [POS]: Shared panel persistence boundary; no transcript body or private URL is persisted.
 */
import { decodeImageIdentity, type ImageRegion } from "../image/identity";
import { readSidePanelLayout, commitSidePanelLayout, type SidePanelStorage, SIDE_PANEL_MAX_WIDTH } from "@ai-chat/ui/lib/side-panel-layout";
import { PanelSlotStore } from "../slots";
export type PanelTabId = "base" | "subagents" | "browser" | `app:${string}` | ImageRegion;
export type PanelSlots = { tabs: PanelTabId[]; active: PanelTabId | null; touched: boolean };
const openChats = new Map<string, boolean>();
export const conversationKey = (chatId: string, incarnationId: string) => JSON.stringify([chatId, incarnationId]);
export type PanelMemory = {
  readSlots(key: string, imageAllowed: (id: ImageRegion) => boolean): PanelSlots;
  writeSlots(key: string, slots: PanelSlots): void;
  readOpenIntent(key: string): boolean;
  rememberOpenIntent(key: string, open: boolean): void;
};
export const readOpenIntent = (key: string) => openChats.get(key) ?? false;
export function rememberOpenIntent(key: string, open: boolean) { openChats.delete(key); openChats.set(key, open); if (openChats.size > 64) openChats.delete(openChats.keys().next().value!); }
export const SLOT_KEY = "bottega.cloud.panel-slots.v1", WIDTH_KEY = "bottega.cloud.side-panel.v1";
export function sanitizeSlots(value: unknown, imageAllowed: (id: ImageRegion) => boolean): PanelSlots {
  const raw = value as Partial<PanelSlots> | null;
  const tabs = Array.isArray(raw?.tabs) ? [...new Set(raw.tabs)].filter((id): id is PanelTabId => typeof id === "string" &&
    (id === "base" || id === "subagents" || id === "browser" || id.startsWith("app:") && id.length > 4 || decodeImageIdentity(id) !== null && imageAllowed(id as ImageRegion))).slice(0, 32) : [];
  return { tabs, active: tabs.includes(raw?.active as PanelTabId) ? raw!.active! : tabs.at(-1) ?? null, touched: Boolean(raw?.touched) };
}
function slotStore(storage?: SidePanelStorage) {
  const isTab = (value: unknown): value is PanelTabId => value === "base" || value === "subagents" || value === "browser" || typeof value === "string" && (value.startsWith("app:") && value.length > 4 || decodeImageIdentity(value) !== null);
  return new PanelSlotStore<string, PanelTabId>({ storageKey: SLOT_KEY, format: "object", storage: () => { try { return storage ?? window.localStorage; } catch { return null; } },
    key: key => key, isTab, isRegion: isTab, eligible: () => true });
}
export function readSlots(key: string, imageAllowed: (id: ImageRegion) => boolean, storage?: SidePanelStorage): PanelSlots {
  const value = slotStore(storage).get(key);
  return sanitizeSlots({ tabs: [...value.tabs], active: value.active || null, touched: value.revision > 0 }, imageAllowed);
}
export function writeSlots(key: string, slots: PanelSlots, storage?: SidePanelStorage) {
  slotStore(storage).replace(key, slots.tabs, slots.active ?? "");
}
export function panelWidth(viewport: number, artifactId?: string) {
  const key = artifactId ? `${WIDTH_KEY}:artifact:${encodeURIComponent(artifactId)}` : WIDTH_KEY;
  try { if (artifactId && !window.localStorage.getItem(key)) return SIDE_PANEL_MAX_WIDTH; }
  catch { if (artifactId) return SIDE_PANEL_MAX_WIDTH; }
  return readSidePanelLayout(key, undefined, viewport).width;
}
export function savePanelWidth(width: number, artifactId?: string) { return commitSidePanelLayout(artifactId ? `${WIDTH_KEY}:artifact:${encodeURIComponent(artifactId)}` : WIDTH_KEY, { width }, {}).width; }

export const panelMemory: PanelMemory = { readSlots, writeSlots, readOpenIntent, rememberOpenIntent };
