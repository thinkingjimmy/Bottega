/**
 * [INPUT]: Depends on React focus/effect, Button and ready GalleryItem; Receiving controlled comment text/coordinates
 * [OUTPUT]: Provides GalleryCommentEditor with GalleryCommentEditorValue, with initial focus, keyboard coordinates and submit/cancel
 * [POS]: The comments layer of bases/views/gallery; Focus returns is the responsibility of the interactive roots
 */

import { useEffect, useRef } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { GalleryItem } from "@/lib/gallery/model";

export type GalleryCommentEditorValue = {
  id?: string;
  item: Extract<GalleryItem, { phase: "ready" }>;
  x: number;
  y: number;
  text: string;
};

export function GalleryCommentEditor({
  editor,
  onText,
  onPosition,
  onSave,
  onCancel,
}: {
  editor: GalleryCommentEditorValue;
  onText(text: string): void;
  onPosition(x: number, y: number): void;
  onSave(): void;
  onCancel(): void;
}) {
  const { t } = useAppTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => textareaRef.current?.focus(), []);
  return (
    <div
      aria-label={t("bases.gallery.commentEditor")}
      className="absolute right-4 bottom-4 z-50 w-[min(22rem,calc(100%-2rem))] rounded-xl border bg-background p-3 shadow-xl"
      onKeyDown={(event) => {
        // Esc 在编辑器内任何焦点位（slider/按钮/textarea）都取消，保证 Esc 优先级链的第一级
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      role="dialog"
    >
      <label className="font-medium text-xs" htmlFor="gallery-comment-editor">
        {t("bases.gallery.commentEditor")}
      </label>
      <div
        aria-label={t("bases.gallery.commentPosition")}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(editor.x * 100)}
        aria-valuetext={t("bases.gallery.commentPositionValue", {
          x: Math.round(editor.x * 100),
          y: Math.round(editor.y * 100),
        })}
        className="relative mt-2 size-24 rounded-md border bg-muted/40 outline-none ring-primary focus-visible:ring-2"
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.1 : 0.01;
          const movement = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          }[event.key];
          if (!movement) return;
          event.preventDefault();
          onPosition(
            Math.min(1, Math.max(0, editor.x + movement[0])),
            Math.min(1, Math.max(0, editor.y + movement[1]))
          );
        }}
        role="slider"
        tabIndex={0}
      >
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: `${editor.x * 100}%`, top: `${editor.y * 100}%` }}
        />
      </div>
      <textarea
        className="mt-2 min-h-24 w-full resize-y rounded-md border bg-transparent p-2 text-sm"
        id="gallery-comment-editor"
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            onSave();
          }
        }}
        ref={textareaRef}
        value={editor.text}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button className="min-h-11" onClick={onCancel} type="button" variant="ghost">
          {t("common.cancel")}
        </Button>
        <Button
          className="min-h-11"
          disabled={!editor.text.trim()}
          onClick={onSave}
          type="button"
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
