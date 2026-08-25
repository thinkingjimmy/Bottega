"use client";

/**
 * [INPUT]: Depends on React context and streamdown CustomRenderer type
 * [OUTPUT]: Provides MessageRendererContext, Provider and useMessageRenderers
 * [POS]: The host of ai-elements/message expands the boundaries; ui doesn't know any business language
 */

import { createContext, useContext, type ReactNode } from "react";
import type { CustomRenderer } from "streamdown";
export type { CustomRenderer, CustomRendererProps } from "streamdown";

export const MessageRendererContext = createContext<CustomRenderer[]>([]);

export function MessageRendererProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: CustomRenderer[];
}) {
  return (
    <MessageRendererContext.Provider value={value}>
      {children}
    </MessageRendererContext.Provider>
  );
}

export const useMessageRenderers = () => useContext(MessageRendererContext);
