/**
 * [INPUT]: Depends on browser contenteditable DOM, PromptInput RichValue and rich-input-model standardization rules
 * [OUTPUT]: Provides readRichEditor/readRichRange with candidate local scrolling rules, projecting the native DOM to the structured value/linear range and keeping keyboard options visible
 * [POS]: The RichInput browser adaptation layer of ui/lib; Temporary DOM, pure models do not perceive Node/Range
 */

import type {
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import {
  normalizeRichValue,
  type RichRange,
} from "@ai-chat/ui/lib/rich-input-model";

export type BrowserRange = {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
};

type VerticalBounds = {
  top: number;
  bottom: number;
};

type ScrollViewport = {
  scrollTop: number;
  getBoundingClientRect: () => VerticalBounds;
};

type BoundedElement = {
  getBoundingClientRect: () => VerticalBounds;
};

export function keepRichSuggestionVisible(
  list: ScrollViewport,
  item: BoundedElement
) {
  const listRect = list.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  if (itemRect.bottom > listRect.bottom) {
    list.scrollTop += itemRect.bottom - listRect.bottom;
  } else if (itemRect.top < listRect.top) {
    list.scrollTop -= listRect.top - itemRect.top;
  }
}

const newText = (value: string): RichNode => ({
  id: crypto.randomUUID(),
  type: "text",
  value,
});

export function readRichEditor(editor: HTMLDivElement, source: RichValue) {
  const known = new Map(source.map((node) => [node.id, node]));
  const result: RichValue = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) result.push(newText(node.textContent));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const nodeId = node.dataset.richNodeId;
    if (nodeId) {
      const rich = known.get(nodeId);
      if (rich && rich.type !== "text") result.push({ ...rich });
      return;
    }
    const textId = node.dataset.richTextId;
    if (textId) {
      const text = node.textContent ?? "";
      if (text) result.push({ id: textId, type: "text", value: text });
      return;
    }
    if (node.tagName === "BR") {
      result.push(newText("\n"));
      return;
    }
    const before = result.length;
    node.childNodes.forEach(visit);
    if (
      node.tagName === "DIV" &&
      result.length > before &&
      node.nextSibling
    ) {
      result.push(newText("\n"));
    }
  };
  editor.childNodes.forEach(visit);
  return normalizeRichValue(result);
}

function editorChildLength(node: Node) {
  if (node instanceof HTMLElement && node.dataset.richNodeId) return 1;
  if (node instanceof HTMLBRElement) return 1;
  return node.textContent?.length ?? 0;
}

function boundaryOffset(
  editor: HTMLDivElement,
  container: Node,
  offset: number
) {
  const children: Node[] = [...editor.childNodes];
  if (container === editor) {
    return children
      .slice(0, Math.max(0, Math.min(offset, children.length)))
      .reduce((total, child) => total + editorChildLength(child), 0);
  }
  let direct = container;
  while (direct.parentNode && direct.parentNode !== editor) {
    direct = direct.parentNode;
  }
  const index = children.indexOf(direct);
  if (index < 0) return 0;
  const prefix = children
    .slice(0, index)
    .reduce((total, child) => total + editorChildLength(child), 0);
  if (direct instanceof HTMLElement && direct.dataset.richNodeId) {
    return prefix + 1;
  }
  const range = document.createRange();
  try {
    range.setStart(direct, 0);
    range.setEnd(container, offset);
    return prefix + Math.min(range.toString().length, editorChildLength(direct));
  } catch {
    return prefix;
  }
}

export function readRichRange(
  editor: HTMLDivElement,
  source?: BrowserRange
): RichRange | null {
  const selection = window.getSelection();
  const range =
    source ??
    (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
  if (
    !range ||
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }
  return {
    start: boundaryOffset(editor, range.startContainer, range.startOffset),
    end: boundaryOffset(editor, range.endContainer, range.endOffset),
  };
}
