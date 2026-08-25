/**
 * [INPUT]: Accepts ChatComposer and Gallery host Registered public focus action
 * [OUTPUT]: Provides a narrow controller for registering/calling composer and gallery focus by chatId
 * [POS]: The focus of the lib/gallery link; Hide the RichInput DOM ref to avoid Tab rotation and private ref collusion across components
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
