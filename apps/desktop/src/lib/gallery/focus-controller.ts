/**
 * [INPUT]: Accepts focus callbacks registered by the ChatComposer and the Gallery host, keyed by chatId
 * [OUTPUT]: Provides a narrow controller for registering/calling composer and gallery focus by chatId
 * [POS]: The cross-component focus link for lib/gallery; it keeps the RichInput DOM ref private so components hand off focus without sharing refs directly
 */

const composers = new Map<string, () => void>();
const galleries = new Map<string, () => void>();

export function registerComposerFocus(chatId: string, focus: () => void) {
  composers.set(chatId, focus);
  return () => {
    if (composers.get(chatId) === focus) composers.delete(chatId);
  };
}

export function registerGalleryFocus(chatId: string, focus: () => void) {
  galleries.set(chatId, focus);
  return () => {
    if (galleries.get(chatId) === focus) galleries.delete(chatId);
  };
}

export const focusComposer = (chatId: string) => composers.get(chatId)?.();
export const focusGallery = (chatId: string) => galleries.get(chatId)?.();
