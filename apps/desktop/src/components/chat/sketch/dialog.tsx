/**
 * [INPUT]: Native composer ownership, source transactions and shared Sketch editor.
 * [OUTPUT]: Native SketchDialog with atomic PNG/source save and focus restoration.
 * [POS]: Platform adapter; browser-safe drawing lives in chat-ui.
 */
import SharedSketchDialog from "@ai-chat/chat-ui/sketch-dialog";
import { SketchTranslationProvider } from "@ai-chat/chat-ui/sketch-platform";
import { useComposerTranslation } from "@ai-chat/chat-ui/composer-translation";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { composerOwnerValid } from "@/lib/chat-composer-store";
import { assertSketchSave, saveComposerSketch } from "@/lib/chat-composer/sketch";
import { closeSketch, type SketchSession } from "./host/controller";
export default function SketchDialog({ session }: { session: SketchSession }) {
 const { i18n } = useAppTranslation(), t = useComposerTranslation(i18n.language);
 return <SketchTranslationProvider value={t}><SharedSketchDialog session={{
  ...session, owner: { ...session.owner, valid: () => composerOwnerValid(session.owner) },
  assertSave: () => assertSketchSave(session.owner, session.attachmentId),
  save: (source, png) => { saveComposerSketch(session.owner, source, png, session.attachmentId); },
  close: saved => closeSketch(session.id, saved),
 }} /></SketchTranslationProvider>;
}
