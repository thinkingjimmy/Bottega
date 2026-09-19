/**
 * [INPUT]: Shared side-panel geometry and storage helpers.
 * [OUTPUT]: Desktop geometry exports and persistence bound to the desktop storage key.
 * [POS]: Desktop boundary over the shared layout contract.
 */
export * from "@ai-chat/ui/lib/side-panel-layout";
import { readSidePanelLayout as read, commitSidePanelLayout as commit, type SidePanelLayout, type SidePanelStorage } from "@ai-chat/ui/lib/side-panel-layout";
const KEY = "ai-chat.side-panel-layout.v1";
export const readSidePanelLayout = (storage?: SidePanelStorage, viewportWidth?: number) => read(KEY, storage, viewportWidth);
export const commitSidePanelLayout = (current: SidePanelLayout, patch: Partial<SidePanelLayout>, storage?: SidePanelStorage) => commit(KEY, current, patch, storage);

export const nativePanelWidths: import("@ai-chat/chat-ui/side-panel/layout").PanelWidths = {
  read: preview => preview ? 1024 : readSidePanelLayout().width,
  write: (width, preview) => preview ? width : commitSidePanelLayout(readSidePanelLayout(), { width }).width,
};
