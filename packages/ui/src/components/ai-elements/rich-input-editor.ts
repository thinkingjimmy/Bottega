/**
 * [INPUT]: Depends on browser Selection/Range DOM and PromptInput RichValue/RichNode type
 * [OUTPUT]: Provides RichInput's caret reading, selection of zone attributes, plain text pasting, thenable, differentiation, value comparison/text, constructions and suggestion, snapshot types
 * [POS]: ai-elements RichInput's browser editor is a dedicated assistant; Main components only arrange events and state migrations
 */

import type {
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { RichCaretPoint } from "@ai-chat/ui/lib/rich-input-model";
import type { RichQuery } from "@ai-chat/ui/lib/rich-input-model";
import type { ClipboardEvent } from "react";

export type RichSuggestionTransaction = {
  id: number;
  query: RichQuery;
  sourceValue: string;
};

export function isThenable<T>(
  value: T | PromiseLike<T>
): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T> | null)?.then === "function";
}

export function pasteRichPlainText(
  event: ClipboardEvent<HTMLDivElement>,
  insert: (text: string) => void
) {
  const plain = event.clipboardData.getData("text/plain");
  if (!plain) return;
  event.preventDefault();
  insert(plain);
}

export const newText = (value: string): RichNode => ({
  id: crypto.randomUUID(),
  type: "text",
  value,
});

export function selectionPoint(editor: HTMLDivElement): RichCaretPoint | null {
  const selection = window.getSelection();
  if (
    !selection?.isCollapsed ||
    !selection.anchorNode ||
    !editor.contains(selection.anchorNode)
  ) {
    return null;
  }
  const anchor = selection.anchorNode;
  if (anchor === editor) {
    return { index: selection.anchorOffset, offset: 0 };
  }
  let direct: Node = anchor;
  while (direct.parentNode && direct.parentNode !== editor) {
    direct = direct.parentNode;
  }
  const children: Node[] = [...editor.childNodes];
  const directIndex = children.indexOf(direct);
  if (directIndex < 0) return null;
  if (direct.nodeType === Node.TEXT_NODE) {
    return { index: directIndex, offset: selection.anchorOffset };
  }
  const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const textElement = element?.closest<HTMLElement>("[data-rich-text-id]");
  if (textElement) {
    const range = document.createRange();
    range.setStart(textElement, 0);
    range.setEnd(anchor, selection.anchorOffset);
    return { index: directIndex, offset: Math.max(0, range.toString().length) };
  }
  const child = element?.closest<HTMLElement>("[data-rich-node-id]");
  return { index: child ? directIndex + 1 : directIndex, offset: 0 };
}

export function selectionInside(editor: HTMLDivElement) {
  const anchor = window.getSelection()?.anchorNode;
  return Boolean(anchor && editor.contains(anchor));
}

export function placeCaret(editor: HTMLDivElement, point: RichCaretPoint) {
  const children = [...editor.children];
  const target = children[point.index];
  const range = document.createRange();
  if (target?.hasAttribute("data-rich-text-id")) {
    const text = target.firstChild;
    if (text) {
      range.setStart(text, Math.min(point.offset, text.textContent?.length ?? 0));
    } else {
      range.setStart(target, 0);
    }
  } else {
    range.setStart(editor, Math.min(point.index, children.length));
  }
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export const cloneValue = (value: RichValue): RichValue =>
  value.map((node) => ({ ...node }));

export const sameValue = (left: RichValue, right: RichValue) =>
  JSON.stringify(left) === JSON.stringify(right);

export const sameEditorValue = (left: RichValue, right: RichValue) =>
  JSON.stringify(
    left.map((node) =>
      node.type === "text" ? { type: node.type, value: node.value } : node
    )
  ) ===
  JSON.stringify(
    right.map((node) =>
      node.type === "text" ? { type: node.type, value: node.value } : node
    )
  );
