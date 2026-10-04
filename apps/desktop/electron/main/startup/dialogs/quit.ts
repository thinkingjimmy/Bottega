/**
 * [INPUT]: Safe-quit failure facts, typed draft outcomes, current activity and the bundled desktop dialog.
 * [OUTPUT]: Running-conversation consent and focused quit/draft feedback; native close and default focus cancel.
 * [POS]: Presentation adapter only; SafeQuitCoordinator alone decides whether force exit is permitted.
 */
import { inspect } from "node:util";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../../shared/i18n/native";
import { DraftSettlementError } from "../../window/surfaces/core/draft-settlement";
import type { QuitFailure } from "../shutdown/safe-quit";
import { desktopCopy } from "./copy";
import { quitPresentation } from "./presentation";
import { dialogFeedback, supportActions } from "./surface/feedback";
import { openDesktopDialog } from "./surface/window";

export async function confirmConversationQuit(locale: AppLocale) {
  let confirmed = false;
  const surface = await openDesktopDialog({ locale, model:{ screen:"quit-confirm", title:desktopCopy(locale, "quitTitle"), message:desktopCopy(locale, "quitMessage"),
    actions:[{ id:"cancel", label:desktopCopy(locale, "cancel") }, { id:"quit", label:desktopCopy(locale, "quit"), primary:true }], defaultAction:"cancel" },
    onAction:action => { confirmed = action.id === "quit"; surface.close(); } });
  await surface.closed;
  return confirmed;
}

export async function showQuitFailure(locale: AppLocale, failure: QuitFailure, activity: { tasks: number; processes: number }, canForce: boolean) {
  const draft = failure.cause instanceof DraftSettlementError ? failure.cause : null;
  const timedOut = draft?.windows.some(window => window.cause instanceof Error && window.cause.message === "Surface migration timed out: flushed") ?? false;
  const copy = quitPresentation(locale, { ...failure, ...activity, draftTimedOut:timedOut });
  const force = canForce && failure.draftsSaved && failure.stage === "quiesce-agents";
  let confirmed = false;
  const surface = await openDesktopDialog({ locale, model:{ screen:failure.draftsSaved ? "quit-failed" : "draft-failed", title:copy.title, message:copy.detail,
    support:supportActions(locale), actions:force ? [{ id:"cancel", label:desktopCopy(locale, "cancel") }, { id:"force", label:translate(locale, "settings.native.quitForce"), primary:true }]
      : [{ id:"return", label:desktopCopy(locale, failure.draftsSaved ? "cancel" : "returnEditing"), primary:!failure.draftsSaved }], defaultAction:force ? "cancel" : "return" },
    onAction:action => {
      if (action.id === "copy" || action.id === "report") { void feedback(action.id); return; }
      confirmed = action.id === "force" && force; surface.close();
    } });
  const feedback = dialogFeedback(surface, locale, () => inspect(failure.cause, { depth:null }));
  await surface.closed;
  return confirmed;
}
