/**
 * [INPUT]: Depends on the owner-bound session, shared modal primitives, editor state, and lazy Sketch content with a matching skeleton.
 * [OUTPUT]: Provides an immediately mounted square Sketch dialog with a full-size canvas, keyboard ownership, and dirty-aware close.
 * [POS]: Eager dialog shell; only drawing content suspends while the root host survives route and Chat changes.
 */
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import {
  Dialog,
  DialogDescription,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import {
  AppDialogContent,
  ConfirmationDialog,
} from "@ai-chat/ui/components/ui/app-dialog";
import { useSketchTranslation as useAppTranslation } from "./platform";
import { sketchErrorMessage, type SketchSession } from "./platform";
import { SketchEditor } from "./editor/state";
import { SketchKeyboard } from "./editor/keyboard";
import { SketchContent } from "./host/editor-loader";
import { SketchLoading } from "./host/loading";
import "./sketch.css";
export default function SketchDialog({
  session,
}: {
  session: SketchSession;
}) {
  const { t } = useAppTranslation();
  const [editor] = useState(
    () =>
      new SketchEditor(session.document, Boolean(session.attachmentId), () =>
        session.close(),
        error => sketchErrorMessage(error, t),
      ),
  );
  const [keyboard] = useState(() => new SketchKeyboard(editor));
  useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  useEffect(() => {
    const blur = () => keyboard.cancel();
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        editor.confirmClose ||
        event.isComposing ||
        event.keyCode === 229 ||
        editor.textDraft?.composing
      )
        return;
      // Closing Radix layers remain mounted during their exit animation.
      // Resolve Escape before those layers can consume a new canvas gesture's cancellation.
      event.preventDefault();
      event.stopPropagation();
      if (!keyboard.cancel()) editor.escape();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
    };
  }, [editor, keyboard]);
  return (
    <TooltipProvider><Dialog
      open
      onOpenChange={(open) => {
        if (!open) editor.requestClose();
      }}
    >
      <AppDialogContent
        data-sketch-dialog
        data-sketch-owner={session.owner.chatId}
        showCloseButton={false}
        className="sketch-dialog bg-white p-0"
        style={{
          width: "var(--sketch-size)",
          height: "var(--sketch-size)",
          maxWidth: "var(--sketch-size)",
          maxHeight: "var(--sketch-size)",
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLElement>(
              "[data-sketch-canvas], [data-sketch-loading-close]",
            )
            ?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (event.isComposing || event.keyCode === 229) return;
          if (!keyboard.cancel()) editor.escape();
        }}
        onKeyDown={(event) => {
          keyboard.down(event.nativeEvent);
          event.stopPropagation();
        }}
        onKeyUp={(event) => {
          keyboard.up(event.nativeEvent);
          event.stopPropagation();
        }}
      >
        <DialogTitle className="sr-only">{t("sketch.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("sketch.description")}
        </DialogDescription>
        <Suspense
          fallback={
            <SketchLoading onClose={() => editor.requestClose()} />
          }
        >
          <SketchContent editor={editor} session={session} />
        </Suspense>
        <ConfirmationDialog
          open={editor.confirmClose}
          title={t("sketch.discardTitle")}
          description={t("sketch.discardDescription")}
          cancelLabel={t("sketch.continueEditing")}
          confirmLabel={t("sketch.discardChanges")}
          confirmTone="destructive"
          initialFocus="cancel"
          onOpenChange={(open) => {
            editor.patch({ confirmClose: open });
          }}
          onConfirm={() => session.close()}
        />
      </AppDialogContent>
    </Dialog></TooltipProvider>
  );
}
