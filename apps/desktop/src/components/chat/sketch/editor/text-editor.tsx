/**
 * [INPUT]: Depends on editor text copies, shared font metrics/tab stops, and native textarea composition events.
 * [OUTPUT]: Provides a re-editable scaled DOM text overlay without intercepting native input undo or IME.
 * [POS]: Accessible text input layer over the canvas; color controls preserve its uncommitted copy.
 */
import { useEffect, useRef } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { layoutText, textStyle } from "../render/text-layout";
import type { SketchEditor } from "./state";
export function SketchTextEditor({
  editor,
  scale,
}: {
  editor: SketchEditor;
  scale: number;
}) {
  const { t } = useAppTranslation(),
    ref = useRef<HTMLTextAreaElement>(null),
    draft = editor.textDraft;
  const id = draft?.value.id;
  useEffect(() => {
    ref.current?.focus();
    const field = ref.current;
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  }, [id, editor.textFocusVersion]);
  if (!draft) return null;
  const value = draft.value,
    transform = value.transform,
    layout = layoutText(value),
    displayScale = scale * transform.scaleX;
  return (
    <textarea
      ref={ref}
      aria-label={t("sketch.textInput")}
      data-sketch-text
      value={value.text}
      spellCheck={false}
      onChange={(event) => editor.updateText(event.target.value)}
      onCompositionStart={() => editor.setComposing(true)}
      onCompositionEnd={(event) => {
        editor.updateText(event.currentTarget.value);
        editor.setComposing(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.nativeEvent.isComposing ||
          draft.composing ||
          event.nativeEvent.keyCode === 229
        )
          return;
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          editor.finishText();
        }
      }}
      style={{
        position: "absolute",
        left: transform.x * scale,
        top: transform.y * scale,
        width: value.boxWidth,
        height: Math.min(
          Math.max(value.fontSize * value.lineHeight, layout.bounds.height) + 2,
          (1600 - transform.y) / transform.scaleX,
        ),
        transform: "scale(" + displayScale + ")",
        transformOrigin: "top left",
        ...textStyle(value),
        color: value.color,
        padding: 0,
        margin: 0,
        border: 0,
        outline: "1px solid #2563EB",
        background: "transparent",
        resize: "none",
        overflow: "auto",
        borderRadius: 0,
      }}
    />
  );
}
