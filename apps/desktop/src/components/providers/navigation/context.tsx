/**
 * [INPUT]: Depends on React and Settings actions supplied by the main ProductApp composition root.
 * [OUTPUT]: Provides optional Settings navigation without inventing routes or owning chat state.
 * [POS]: Navigation injection boundary for Settings details, composer menus and their focus return.
 */
import { createContext, useContext } from "react";
export type SettingsNavigation = { openUsage(trigger: HTMLElement | null): void; openAgents(): void };
export const SettingsNavigationContext = createContext<SettingsNavigation | null>(null);
export const useSettingsNavigation = () => useContext(SettingsNavigationContext);
