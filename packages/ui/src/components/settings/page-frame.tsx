/**
 * [INPUT]: React and shared UI primitives.
 * [OUTPUT]: Shared settings canvas, wrapping section headers and alerts.
 * [POS]: Platform-independent settings presentation.
 */

import type { ReactNode } from "react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";

export function SettingsCanvas({
  fill,
  children,
}: {

  fill?: boolean;
  children: ReactNode;
}) {

  if (fill) {
    return (
      <div className="@container mx-auto flex h-full max-w-4xl flex-col p-6 [&>*]:min-h-0 [&>*]:flex-1">
        {children}
      </div>
    );
  }
  return (
    <SlimScroller className="h-full overflow-y-auto">
      <div className="@container mx-auto max-w-4xl px-6 pt-6 pb-12 max-sm:px-4">
        {children}
      </div>
    </SlimScroller>
  );
}

export function SettingsSection({
  title,
  description,
  action,
  alert,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  alert?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `settings-${title.replace(/\s+/g, "-")}`;
  return (

    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="space-y-1">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 id={titleId} className="min-w-0 font-heading font-semibold text-sm">
            {title}
          </h2>
          {action}
        </div>
        {description && (
          <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {alert && <SettingsAlert>{alert}</SettingsAlert>}
      {children}
    </section>
  );
}

export function SettingsAlert({
  children,
  tone = "danger",
}: {
  children: ReactNode;

  tone?: "danger" | "warn";
}) {
  return (
    <p
      role="alert"
      className={cn(
        "rounded-md px-3 py-2 text-xs ring-1",
        tone === "warn"
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
          : "bg-destructive/10 text-destructive ring-destructive/20"
      )}
    >
      {children}
    </p>
  );
}
