/**
 * [INPUT]: Shared modal primitives, SketchPanel and an owner-bound Sketch session.
 * [OUTPUT]: Standalone SketchDialog for direct editor fixtures; production plugins use SketchPanel inside the host modal.
 * [POS]: Thin dialog adapter; editor state, keyboard handling and checkpoints belong to the shared panel.
 */
import { Dialog, DialogDescription, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { useSketchTranslation, type SketchSession } from "./platform";
import { SketchPanel } from "./panel";
import "./sketch.css";

export default function SketchDialog({ session }: { session: SketchSession }) {
  const { t } = useSketchTranslation();
  return (
    <Dialog open onOpenChange={() => {}}>
      <AppDialogContent
        data-sketch-dialog
        showCloseButton={false}
        className="sketch-dialog bg-white p-0"
        style={{ width: "var(--sketch-size)", height: "var(--sketch-size)", maxWidth: "var(--sketch-size)", maxHeight: "var(--sketch-size)" }}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("sketch.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("sketch.description")}</DialogDescription>
        <SketchPanel session={session} />
      </AppDialogContent>
    </Dialog>
  );
}
