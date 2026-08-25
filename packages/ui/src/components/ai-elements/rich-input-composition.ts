/**
 * [INPUT]: Depends on RichInput editor/value refs, pure range replacement model and React composition events
 * [OUTPUT]: Provides use of RichInputComposition, encapsulates IME preview/commit with browser replay input to weight
 * [POS]: The IME business adapter for ai-elements RichInput; The main state machine consumes only three stability event processors
 */

import {
  pointAtRichOffset,
  replaceRichRange,
  richQueryAtPoint,
  richValueLength,
  type RichCaretPoint,
  type RichQuery,
  type RichRange,
} from "@ai-chat/ui/lib/rich-input-model";
import { readRichRange } from "@ai-chat/ui/lib/rich-input-dom";
import type { RichValue } from "./prompt-input";
import { cloneValue } from "./rich-input-editor";
import type {
  CompositionEvent,
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";

type CompositionTransaction = { base: RichValue; range: RichRange };
type Preview = { active: boolean; query: RichQuery | null };

export function useRichInputComposition({
  adoptNativeEditor,
  apply,
  committedComposition,
  composing,
  composition,
  editorRef,
  queryRef,
  setEditorEpoch,
  setPreview,
  setSelected,
  updateQuery,
  valueRef,
}: {
  adoptNativeEditor: () => void;
  apply: (value: RichValue, point?: RichCaretPoint) => void;
  committedComposition: MutableRefObject<string | null>;
  composing: MutableRefObject<boolean>;
  composition: MutableRefObject<CompositionTransaction | null>;
  editorRef: RefObject<HTMLDivElement | null>;
  queryRef: MutableRefObject<RichQuery | null>;
  setEditorEpoch: Dispatch<SetStateAction<number>>;
  setPreview: Dispatch<SetStateAction<Preview>>;
  setSelected: Dispatch<SetStateAction<number>>;
  updateQuery: (query: RichQuery | null) => void;
  valueRef: MutableRefObject<RichValue>;
}) {
  const onCompositionStart = (_event: CompositionEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const end = richValueLength(valueRef.current);
    composing.current = true;
    composition.current = {
      base: cloneValue(valueRef.current),
      range: (editor ? readRichRange(editor) : null) ?? { start: end, end },
    };
    setPreview({ active: true, query: queryRef.current });
  };
  const onCompositionUpdate = (event: CompositionEvent<HTMLDivElement>) => {
    const transaction = composition.current;
    if (!transaction) return;
    const replacement = replaceRichRange(
      transaction.base,
      transaction.range,
      event.data
    );
    const point = pointAtRichOffset(replacement.value, replacement.caret);
    setPreview({
      active: true,
      query: richQueryAtPoint(replacement.value, point),
    });
    setSelected(0);
  };
  const onCompositionEnd = (event: CompositionEvent<HTMLDivElement>) => {
    const transaction = composition.current;
    composing.current = false;
    composition.current = null;
    setPreview({ active: false, query: null });
    if (!transaction) {
      adoptNativeEditor();
      return;
    }
    const replacement = event.data
      ? replaceRichRange(transaction.base, transaction.range, event.data)
      : { value: cloneValue(transaction.base), caret: transaction.range.start };
    committedComposition.current = event.data || null;
    queueMicrotask(() => {
      if (committedComposition.current === event.data) {
        committedComposition.current = null;
      }
    });
    const point = pointAtRichOffset(replacement.value, replacement.caret);
    setEditorEpoch((current) => current + 1);
    updateQuery(richQueryAtPoint(replacement.value, point));
    setSelected(0);
    apply(replacement.value, point);
  };

  return { onCompositionEnd, onCompositionStart, onCompositionUpdate };
}
