/**
 * [INPUT]: Owner-bound session, editor transactions, lazy drawing content and the explicit discard confirmation.
 * [OUTPUT]: SketchPanel fills its host with one editor, local keyboard ownership, acknowledged checkpoints and terminal capture quiescence.
 * [POS]: Shared editor body used by the isolated plugin and the standalone fixture dialog; it creates no outer modal or backdrop.
 */
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useSketchTranslation as useAppTranslation } from "./platform";
import { sketchErrorMessage, type SketchSession } from "./platform";
import { PLUGIN_RECOVERY_INTERVAL_MS } from "@bottega/contracts/plugins/surface/contract";
import { SketchEditor } from "./editor/state";
import { SketchKeyboard } from "./editor/keyboard";
import { SketchContent } from "./host/editor-loader";
import { SketchLoading } from "./host/loading";
import "./sketch.css";
export function SketchPanel({
  session,
}: {
  session: SketchSession;
}) {
  const { t } = useAppTranslation();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-sketch-canvas], [data-sketch-loading-close]")?.focus({ preventScroll: true });
  }, []);
  const [editor] = useState(
    () => {
      const editor = new SketchEditor(session.document, Boolean(session.attachmentId), () => close(),
        error => sketchErrorMessage(error, t), session.createWorker);
      const configuration = session.configuration;
      if (configuration?.palette?.length && configuration.palette.length <= 32 && configuration.palette.every(value => /^#[0-9a-f]{6}$/i.test(value))) editor.palette = configuration.palette;
      if (configuration?.shapes?.length) editor.shapes = configuration.shapes;
      if (session.recovery) editor.restoreCheckpoint(session.recovery);
      return editor;
    },
  );
  const currentSession = useRef(session);
  useLayoutEffect(() => { currentSession.current = session; }, [session]);
  function close() {
    editor.patch({ phase: "saving" });
    void Promise.resolve(currentSession.current.close()).catch(error => { editor.patch({ phase: "idle" }); editor.report(error); });
  };
  const [keyboard] = useState(() => new SketchKeyboard(editor));
  useEffect(() => {
    if (!session.checkpoint && !session.dirty) return;
    let revision = -1, lastDirty = false, pending = false, active = true;
    const dirty = () => {
      const value = editor.dirty || editor.blocked;
      if (value !== lastDirty) { lastDirty = value; currentSession.current.dirty?.(value); }
    };
    const capture = () => {
      dirty();
      if (!active || pending || editor.phase === "saving" || !lastDirty || (!editor.blocked && editor.snapshot() === revision)) return;
      const captured = editor.snapshot(); pending = true;
      void Promise.resolve(currentSession.current.checkpoint?.(editor.checkpoint(), true)).then(() => {
        revision = captured;
      }, error => { if (active && editor.phase !== "saving") editor.report(error); }).finally(() => { pending = false; });
    };
    const stop = editor.subscribe(dirty), timer = setInterval(capture, PLUGIN_RECOVERY_INTERVAL_MS);
    const hidden = () => { if (document.visibilityState === "hidden") capture(); };
    document.addEventListener("visibilitychange", hidden); dirty();
    return () => { active = false; clearInterval(timer); stop(); document.removeEventListener("visibilitychange", hidden); };
  }, [editor]);
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
    <TooltipProvider>
      <div
        ref={panel}
        data-sketch-panel
        data-sketch-owner={session.owner.chatId}
        className="sketch-panel bg-white"
        role="group"
        aria-label={t("sketch.title")}
        onKeyDown={(event) => {
          keyboard.down(event.nativeEvent);
          event.stopPropagation();
        }}
        onKeyUp={(event) => {
          keyboard.up(event.nativeEvent);
          event.stopPropagation();
        }}
      >
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
          onConfirm={close}
        />
      </div>
    </TooltipProvider>
  );
}
