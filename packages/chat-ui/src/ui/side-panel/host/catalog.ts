/**
 * [INPUT]: Shared catalog vocabulary and current singleton slots.
 * [OUTPUT]: Four desktop-equivalent catalog entries and Platform capability predicates.
 * [POS]: Shared directory policy; images can only enter through proven transcript identities.
 */
import { PANEL_CATALOG } from "../catalog";
import type { SidePanelCopy } from "../../../i18n/side-panel";
import { CLOUD_CHAT_CAPABILITIES, type ChatCapabilities } from "../../../platform/contracts";
import type { PanelSlots } from "./memory";
export function panelCatalog(copy: SidePanelCopy, slots: PanelSlots, location?: string, capabilities: Pick<ChatCapabilities, "browser" | "apps"> = CLOUD_CHAT_CAPABILITIES) {
  return { items: PANEL_CATALOG.map(item => ({ id: item.id, ...copy.catalog[item.id], icon: item.icon, ...(item.id === "app" ? { menuHint: true } : {}) })), disabledFor: (id: string) => (id === "browser" && !capabilities.browser || id === "app" && !capabilities.apps) || slots.tabs.some(tab => tab === id),
    disabledReasonFor: (id: string) => (id === "browser" && !capabilities.browser || id === "app" && !capabilities.apps) ? location ?? copy.desktopOnly : undefined,
    accessibleLabel: (item: { label: string }, reason?: string) => (reason ? copy.unavailableNamed : copy.openNamed).replace("{name}", item.label).replace("{reason}", reason ?? "") };
}
