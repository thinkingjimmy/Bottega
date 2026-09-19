/**
 * [INPUT]: Depends on React and Settings actions supplied by the main ProductApp composition root.
 * [OUTPUT]: Provides composition-owned Account, Agent and Usage settings actions — Usage optionally landing on one Agent's tab — without inventing routes or owning chat state.
 * [POS]: Navigation injection boundary for Settings details, composer menus and their focus return.
 */
import { createContext, useContext } from "react";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
/** `openUsage` remembers `trigger` for the return focus; `agent` picks the Usage tab, else the page keeps its own default. */
export type SettingsNavigation = { openUsage(trigger: HTMLElement | null, agent?: AgentBackendId): void; openAgents(): void; openAccount(): void };
export const SettingsNavigationContext = createContext<SettingsNavigation | null>(null);
export const useSettingsNavigation = () => useContext(SettingsNavigationContext);
