/**
 * [INPUT]: Depends on stable Sketch sessions, owner invalidation, the eager dialog shell, and localized copy.
 * [OUTPUT]: Provides one SketchHost per renderer with a route-independent dialog and editor error recovery.
 * [POS]: Shell-level host inside TooltipProvider and outside Routes/Suspense; Dock reuses this instance.
 */
import {
  Component,
  Suspense,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Dialog, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  composerOwnerValid,
  subscribeComposer,
} from "@/lib/chat-composer-store";
import {
  closeSketch,
  readSketchSession,
  subscribeSketchSession,
} from "./controller";
import { SketchDialog } from "./dialog-loader";
class EditorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function SketchHost() {
  const session = useSyncExternalStore(
    subscribeSketchSession,
    readSketchSession,
    readSketchSession,
  );
  const { t } = useAppTranslation();
  useEffect(() => {
    if (!session) return;
    return subscribeComposer(session.owner.chatId, () => {
      if (!composerOwnerValid(session.owner)) closeSketch(session.id);
    });
  }, [session]);
  useEffect(
    () => () => {
      const current = readSketchSession();
      if (current) closeSketch(current.id);
    },
    [],
  );
  if (!session) return null;
  const dismiss = () => closeSketch(session.id);
  const fallback = (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <AppDialogContent
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>{t("sketch.title")}</DialogTitle>
        <p className="py-4 text-sm" role="status">
          {t("sketch.error")}
        </p>
        <Button type="button" onClick={dismiss}>
          {t("common.close")}
        </Button>
      </AppDialogContent>
    </Dialog>
  );
  return (
    <EditorBoundary key={session.id} fallback={fallback}>
      <Suspense fallback={<Dialog open onOpenChange={open => { if (!open) dismiss(); }}><AppDialogContent
        style={{ width: "min(720px, calc(100vw - 48px), calc(100dvh - 48px))", height: "min(720px, calc(100vw - 48px), calc(100dvh - 48px))", maxWidth: "none" }}
        onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
        <DialogTitle className="sr-only">{t("sketch.title")}</DialogTitle><div role="status" className="grid place-items-center">{t("common.loading")}</div>
      </AppDialogContent></Dialog>}><SketchDialog session={session} /></Suspense>
    </EditorBoundary>
  );
}
