/**
 * [INPUT]: Depends on the retained editor/session, Sketch controls and canvas, and atomic PNG/source transactions.
 * [OUTPUT]: Provides SketchContentProps and full-size drawing content with floating controls, canvas focus, and version-checked confirmation.
 * [POS]: Lazy drawing boundary inside the persistent dialog; Konva and color controls stay outside startup JS.
 */
import { useLayoutEffect, useRef } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  assertSketchSave,
  saveComposerSketch,
} from "@/lib/chat-composer/sketch";
import { closeSketch, type SketchSession } from "./host/controller";
import type { SketchEditor } from "./editor/state";
import { SketchSurface } from "./editor/surface";
import { SketchButton, SketchToolbar, SketchWidth } from "./toolbar";
import { SketchColors } from "./color-panel";
import { exportPng } from "./render/export";

export type SketchContentProps = {
  editor: SketchEditor;
  session: SketchSession;
};

export default function SketchEditorContent({
  editor,
  session,
}: SketchContentProps) {
  const { t } = useAppTranslation();
  const layout = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    layout.current
      ?.querySelector<HTMLElement>("[data-sketch-canvas]")
      ?.focus({ preventScroll: true });
  }, []);
  const save = async () => {
    if (editor.blocked || editor.textDraft?.composing || !editor.finishText())
      return;
    editor.finishColor();
    if (!editor.history.dirty && session.attachmentId) {
      closeSketch(session.id, true);
      return;
    }
    if (!editor.document.elements.length) return;
    try {
      assertSketchSave(session.owner, session.attachmentId);
      editor.patch({ phase: "saving", error: "" });
      const source = editor.document,
        png = await exportPng(source);
      assertSketchSave(session.owner, session.attachmentId);
      saveComposerSketch(session.owner, source, png, session.attachmentId);
      closeSketch(session.id, true);
    } catch (error) {
      editor.patch({ phase: "idle" });
      editor.report(error);
    }
  };
  return (
    <div ref={layout} className="sketch-layout">
      <SketchToolbar editor={editor} />
      <div className="sketch-paper">
        <SketchSurface editor={editor} owner={session.owner} />
      </div>
      <SketchWidth editor={editor} />
      <footer className="sketch-footer">
        <SketchColors editor={editor} />
        <SketchButton
          data-sketch-done
          label={
            editor.phase === "saving"
              ? t("sketch.processing")
              : t("sketch.done")
          }
          icon={editor.phase === "saving" ? LoaderCircleIcon : CheckIcon}
          disabled={!editor.canSave}
          onClick={() => void save()}
          className={
            "sketch-done bg-amber-200 text-black hover:bg-amber-300 disabled:bg-amber-100 disabled:text-black/35 " +
            (editor.phase === "saving"
              ? "[&>svg]:animate-spin motion-reduce:[&>svg]:animate-none"
              : "")
          }
        />
      </footer>
      <div className="sketch-notice text-xs" role="status" aria-live="polite">
        {editor.error ? (
          <span className="text-destructive">{editor.error}</span>
        ) : editor.phase === "awaiting-final" ? (
          t("sketch.busyErasing")
        ) : editor.trimmed ? (
          t("sketch.historyTrimmed")
        ) : null}
      </div>
    </div>
  );
}
