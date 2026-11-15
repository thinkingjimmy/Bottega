/**
 * [INPUT]: React and class-name utilities.
 * [OUTPUT]: SettingsInlineAlert — the one inline alert shape shared by SettingsAlert (Settings pages) and AppDialogAlert (dialog bodies): 16px tone icon, 14/500 title, optional 13px muted description and trailing actions on one vertically centred row.
 * [POS]: packages/ui/src/components/settings; single source of the S20 alert shape (radius 14, tone/25 border, tone/6 fill, warn amber/8, padding 12/16). Below a 480px container width the actions drop to their own right-aligned row.
 */

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";

export function SettingsInlineAlert({
  tone = "danger",
  title,
  description,
  action,
  className,
}: {
  tone?: "danger" | "warn";
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "@container flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[0.875rem] px-4 py-3 ring-1",
        tone === "warn"
          ? "bg-amber-500/8 text-amber-700 ring-amber-500/25 dark:text-amber-400"
          : "bg-destructive/6 text-destructive ring-destructive/25",
        className
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
      <div className="min-w-0 flex-1 basis-32">
        <div className="font-medium text-sm">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {action ? (
        <div className="flex shrink-0 items-center gap-2 @max-[480px]:basis-full @max-[480px]:justify-end">
          {action}
        </div>
      ) : null}
    </div>
  );
}
