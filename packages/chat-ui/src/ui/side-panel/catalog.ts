/**
 * [INPUT]: Shared icon primitives and stable panel identifiers.
 * [OUTPUT]: One panel catalog with an Artifact picker entry consumed by native and cloud hosts.
 * [POS]: Presentation vocabulary; host capabilities decide whether an entry opens.
 */
import { BotIcon, DatabaseIcon, FileIcon, GlobeIcon, PanelsTopLeftIcon } from "lucide-react";
export const PANEL_CATALOG = [
  { id: "base", labelKey: "chat.sidePanel.catalog.base.label", hintKey: "chat.sidePanel.catalog.base.hint", icon: DatabaseIcon },
  { id: "subagents", labelKey: "chat.sidePanel.catalog.subagents.label", hintKey: "chat.sidePanel.catalog.subagents.hint", icon: BotIcon },
  { id: "artifact", labelKey: "chat.sidePanel.catalog.artifact.label", hintKey: "chat.sidePanel.catalog.artifact.hint", icon: FileIcon },
  { id: "browser", labelKey: "chat.sidePanel.catalog.browser.label", hintKey: "chat.sidePanel.catalog.browser.hint", icon: GlobeIcon },
  { id: "app", labelKey: "chat.sidePanel.catalog.app.label", hintKey: "chat.sidePanel.catalog.app.hint", icon: PanelsTopLeftIcon },
] as const;
