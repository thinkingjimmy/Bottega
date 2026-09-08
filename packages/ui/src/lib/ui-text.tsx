"use client";

/**
 * [INPUT]: Depends on React Context; The host inserts the key→text function
 * [OUTPUT]: Provides UiTextProvider/useUiText, allowing the sharing of native language default text without relying on specific i18n libraries
 * [POS]: @ai-chat/ui's host-injection boundary for UI text; the Web host falls back to English, the desktop host injects its own locale catalog
 */

import { createContext, useContext, type ReactNode } from "react";

type UiTextResolver = (key: string, fallback: string) => string;
const UiTextContext = createContext<UiTextResolver>((_key, fallback) => fallback);

export function UiTextProvider({
  children,
  resolve,
}: {
  children: ReactNode;
  resolve: UiTextResolver;
}) {
  return <UiTextContext value={resolve}>{children}</UiTextContext>;
}
export function useUiText(key: string, fallback: string) {
  return useContext(UiTextContext)(key, fallback);
}
