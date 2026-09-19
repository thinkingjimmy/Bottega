/**
 * [INPUT]: Shared persistent slots and native context/region eligibility.
 * [OUTPUT]: Native PanelSlotStore and usePanelSlots preserving existing storage identities.
 * [POS]: Thin native policy adapter for the shared side-panel owner.
 */
import { useSyncExternalStore } from "react";
import { PanelSlotStore as SharedSlotStore, type PanelSlotAggregate as SharedAggregate } from "@ai-chat/chat-ui/side-panel/slots";
import { isAppRegion, isImageRegion, type PanelTabId, type PanelRegion } from "./panel-catalog";
import { panelConversationKey, panelGenerationKey, panelEligibility, type PanelSessionContext } from "../runtime/chat-session-model";
export type PanelSlotAggregate = SharedAggregate<PanelTabId, PanelRegion>;
const isTab = (value: unknown): value is PanelTabId => value === "base" || value === "subagents" || typeof value === "string" && (isAppRegion(value) || isImageRegion(value));
export class PanelSlotStore extends SharedSlotStore<PanelSessionContext, PanelTabId, PanelRegion> {
  constructor() { super({ storageKey: "ai-chat:panel-slots:v1", storage: () => { try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; } },
    key: context => `${panelConversationKey(context)}\u0000${panelGenerationKey(context)}`,
    isTab, isRegion: (value): value is PanelRegion => value === "browser" || isTab(value), independent: (_, region) => region === "browser",
    eligible: (context, region) => panelEligibility(context, isImageRegion(region) ? "image" : isAppRegion(region) ? "app" : region).allowed,
  }); }
}
export const panelSlotStore = new PanelSlotStore();
export function usePanelSlots(context: PanelSessionContext) {
  return useSyncExternalStore(panelSlotStore.subscribe, () => panelSlotStore.getFor(context), () => panelSlotStore.getFor(context));
}
