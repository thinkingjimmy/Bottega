/**
 * [INPUT]: Depends on React context, ConversationImageProjection and Gallery running
 * [OUTPUT]: Provides GalleryOverlayProvider/useGalleryRunningOverlay; only the current Chat host's ephemeral items are exposed
 * [POS]: Narrow Chat-to-Base-Gallery overlay bridge; Project/App hosts have no provider and fall back to durable rows only
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
