/**
 * [INPUT]: Depends on the shared workbench copy (`appOps`, U06-c) and its formatter.
 * [OUTPUT]: Provides the lines of an App's first Edit message (U06 Q7 / U06-c): AppEditTextOnly (the text-only rule), AppEditStarting (which
 *           computer is starting the Edit Chat), AppEditFailure / appEditFailureText (a sealed refusal or a second expiry by name) and the
 *           synchronous appEditTextOnly / appEditFilledNotice for a paste refusal and the notice the existing Edit Chat shows.
 * [POS]: Composer piece used by ../create.tsx only when it creates an App's first Edit Chat; ordinary Chats never load the workbench copy.
 */
import { formatWorkbench, getWorkbenchCopy, useWorkbenchCopy, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";

type Values = { app: string; computer: string };
export type AppEditFailureFacts = { reason: string; refusal?: string };

/** Synchronous (the language chunk is already loading for the rule line on the same page). */
export const appEditTextOnly = (locale: string) => getWorkbenchCopy(locale).appOps.firstMessageText;
export const appEditFilledNotice = (locale: string, values: Values) => formatWorkbench(getWorkbenchCopy(locale).appOps.reservationFilled, values);

/** A sealed refusal by its code, or the second expiry; null leaves the composer's own sentence for anything else. */
export function appEditFailureText(workbench: WorkbenchCopy, failure: AppEditFailureFacts, values: Values): string | null {
  const copy = workbench.appOps;
  switch (failure.refusal) {
    case "app-not-found": return formatWorkbench(copy.appNotFound, values);
    case "app-not-editable": return formatWorkbench(copy.appNotEditable, values);
    case "app-transitioning": return formatWorkbench(copy.appTransitioning, values);
    case "agent-unavailable": return formatWorkbench(copy.agentUnavailable, values);
    case "startup-recovery-pending": return copy.startupPending;
    case "earlier-process-holding": return copy.earlierProcess;
  }
  return failure.reason === "reservation-expired" ? formatWorkbench(copy.reservationExpired, values) : null;
}

export function AppEditTextOnly({ locale }: { locale: string }) {
  const workbench = useWorkbenchCopy(locale);
  return <p className="m-0 px-1 text-xs text-muted-foreground" data-app-edit-text-only="">{workbench.appOps.firstMessageText}</p>;
}
export function AppEditStarting({ locale, computer }: { locale: string; computer: string }) {
  const workbench = useWorkbenchCopy(locale);
  return <>{formatWorkbench(workbench.appOps.startingEdit, { computer })}</>;
}
export function AppEditFailure({ locale, failure, values, fallback }: { locale: string; failure: AppEditFailureFacts; values: Values; fallback: string }) {
  const workbench = useWorkbenchCopy(locale);
  return <>{appEditFailureText(workbench, failure, values) ?? fallback}</>;
}
