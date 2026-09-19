/**
 * [INPUT]: Shared browser-safe Sketch implementation.
 * [OUTPUT]: Native import aliases for pointer.
 * [POS]: Desktop compatibility path; implementation belongs to chat-ui.
 */
export * from "@ai-chat/chat-ui/sketch/editor/pointer";

import { SketchPointer as SharedPointer } from "@ai-chat/chat-ui/sketch/editor/pointer";
import { composerOwnerValid, type ComposerOwner } from "@/lib/chat-composer-store";
import type { SketchEditor } from "@ai-chat/chat-ui/sketch/editor/state";
export class SketchPointer extends SharedPointer {
  constructor(editor: SketchEditor, owner: ComposerOwner) { super(editor, { ...owner, valid: () => composerOwnerValid(owner) }); }
}
