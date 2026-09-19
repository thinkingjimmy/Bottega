/**
 * [INPUT]: Depends on renderer composer owners, source pins, modal keyboard ownership, and stable invocation focus anchors.
 * [OUTPUT]: Provides one route-independent Sketch session and deterministic close/focus behavior.
 * [POS]: Stable host controller; never imports the editor, Konva, or worker runtime.
 */
import {
  assertComposerOwner,
  captureComposerOwner,
  type ComposerOwner,
} from "@/lib/chat-composer-store";
import {
  pinSketchEditor,
  readSketchSource,
  releaseSketchEditor,
} from "@/lib/chat-composer/sketch";
import { acquireModalKeyboardScope } from "@/lib/modal-keyboard/scope";
import {
  createDocument,
  validateDocument,
  type SketchDocument,
} from "@ai-chat/chat-ui/sketch/model/document";
export type SketchSession = Readonly<{
  id: string;
  owner: ComposerOwner;
  document: SketchDocument;
  attachmentId?: string;
  returnFocus: HTMLElement | null;
  focusComposer(): boolean;
}>;
let session: SketchSession | null = null;
let releaseKeyboard: (() => void) | undefined;
const listeners = new Set<() => void>();
export const readSketchSession = () => session;
export const subscribeSketchSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function openSketch(
  chatId: string,
  attachmentId?: string,
  focusComposer: () => boolean = () => false,
  returnFocus: HTMLElement | null =
    globalThis.document?.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null,
) {
  if (session) throw new Error("SKETCH_EDITOR_ACTIVE");
  const owner = captureComposerOwner(chatId);
  assertComposerOwner(owner);
  const document = attachmentId
    ? readSketchSource(chatId, attachmentId)
    : createDocument();
  if (!document) throw new Error("SKETCH_SOURCE_MISSING");
  validateDocument(document);
  const id = crypto.randomUUID();
  pinSketchEditor(owner, id, attachmentId);
  releaseKeyboard = acquireModalKeyboardScope();
  session = {
    id,
    owner,
    document,
    attachmentId,
    returnFocus,
    focusComposer,
  };
  for (const listener of listeners) listener();
}
export function closeSketch(id: string, saved = false) {
  const previous = session;
  if (!previous || previous.id !== id) return;
  session = null;
  releaseSketchEditor(previous.owner, previous.id);
  releaseKeyboard?.();
  releaseKeyboard = undefined;
  for (const listener of listeners) listener();
  queueMicrotask(() => {
    if (saved && previous.focusComposer()) return;
    if (previous.returnFocus?.isConnected) {
      previous.returnFocus.focus({ preventScroll: true });
      return;
    }
    const root = globalThis.document?.querySelector<HTMLElement>(
      "main, [data-slot=sidebar-inset], #root",
    );
    if (root) {
      if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
      root.focus({ preventScroll: true });
    }
  });
}
