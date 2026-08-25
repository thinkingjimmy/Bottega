/**
 * [INPUT]: Depends on React context, ConversationImageProjection and Gallery running
 * [OUTPUT]: Provides GalleryOverlayProvider/useGalleryRunningOverlay; Only current Chat hosts exposed ephemeral items
 * [POS]: Chat→Base Gallery's narrow overlay connections; Project/App: Only durable rows when there is no provider
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ConversationImageProjection } from "@/components/chat/side-panel/image/image-projection";
import { projectRunningGalleryItems } from "./running-overlay";

const GalleryOverlayContext = createContext<ConversationImageProjection | null>(
  null
);

export function GalleryOverlayProvider({
  projection,
  children,
}: {
  projection: ConversationImageProjection;
  children: ReactNode;
}) {
  return (
    <GalleryOverlayContext.Provider value={projection}>
      {children}
    </GalleryOverlayContext.Provider>
  );
}

export function useGalleryRunningOverlay(chatId?: string) {
  const projection = useContext(GalleryOverlayContext);
  return useMemo(
    () =>
      projection && chatId === projection.chatId
        ? projectRunningGalleryItems(projection)
        : [],
    [chatId, projection]
  );
}
