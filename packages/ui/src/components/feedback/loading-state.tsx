/**
 * [INPUT]: Host-owned loading/failure state, locale, scoped recovery callback and optional access-specific copy.
 * [OUTPUT]: LoadingState, the shared loading/failure surface with one consistent recovery control.
 * [POS]: Presentation only; the affected region owns retry, retained content and request identity.
 */
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Button } from "../ui/controls/button";
import { Spinner } from "../ui/feedback/spinner";
import { cn } from "../../lib/utils";
import { connectionCopy } from "./connection-copy";
export function LoadingState({ locale, failed = false, title, description, retry, actionLabel, children, inline = false, className }: {
  locale: string; failed?: boolean; title?: string; description?: string; retry?(): void; actionLabel?: string;
  children?: ReactNode; inline?: boolean; className?: string;
}) {
  const copy = connectionCopy(locale);
  return <div role="status" aria-live="polite" aria-atomic="true" data-feedback={failed ? "failed" : "loading"}
    className={cn("flex min-w-0 gap-4 p-6", inline ? "flex-row flex-wrap items-center gap-3 px-4 py-2" : "flex-1 flex-col items-center justify-center text-center", className)}>
    {failed ? <Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : <Spinner aria-hidden="true" className="size-4 shrink-0" />}
    <div className="min-w-0 space-y-1">
      <p className={cn("m-0 text-sm leading-5", failed ? "font-medium" : "font-normal text-muted-foreground")}>{title ?? (failed ? copy.failed : copy.loading)}</p>
      {(description || failed && description === undefined) && <p className="m-0 text-xs leading-[18px] text-muted-foreground">{description ?? copy.tryLater}</p>}
    </div>
    {(failed && retry || children) && <div className="flex flex-wrap items-center justify-center gap-2">
      {failed && retry && <Button type="button" variant="outline" size="pill" onClick={retry}>{actionLabel ?? copy.retry}</Button>}{children}
    </div>}
  </div>;
}
