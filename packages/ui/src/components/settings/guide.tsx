/**
 * [INPUT]: React and class-name utilities.
 * [OUTPUT]: SettingsSetupGuide — the not-set-up face of a feature (S21, Revision 5 refined): one full-width radius-22 muted panel with a 3fr/2fr grid — 48px icon tile, 22/600 title, 15px muted description and the action row on the left, three bordered-circle facts on the right; columns stack below a 720px panel width.
 * [POS]: packages/ui/src/components/settings; the single guide for features that are not set up yet (Memory, Browser). While it shows, the page header carries no trailing control — the guide owns the one call to action.
 */

import type { ReactNode } from "react";
import { cn } from "@ai-chat/ui/lib/utils";

export type SettingsSetupGuideFact = {
  icon: ReactNode;
  title: string;
  description: ReactNode;
};

export function SettingsSetupGuide({
  icon,
  title,
  description,
  action,
  secondaryAction,
  facts,
  className,
}: {
  /** Feature glyph, drawn at 22px inside the 48px tile. */
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  /** The one call to action — a 36px filled pill. */
  action: ReactNode;
  /** Optional text link beside the action (for example "About Memory ↗"). */
  secondaryAction?: ReactNode;
  /** Up to three unboxed facts; each is a 32px circle + 14/500 title + 13px muted line. */
  facts: readonly SettingsSetupGuideFact[];
  className?: string;
}) {
  return (
    <div className={cn("@container rounded-[1.375rem] bg-muted/40 px-9 py-8 @max-[720px]:p-6", className)}>
      <div className="grid grid-cols-[3fr_2fr] items-center gap-10 @max-[720px]:grid-cols-1">
        <div className="min-w-0">
          <span
            aria-hidden="true"
            className="grid size-12 place-items-center rounded-[0.875rem] bg-background ring-1 ring-foreground/10 [&_svg]:size-[22px]"
          >
            {icon}
          </span>
          <h2 className="mt-5 font-heading font-semibold text-[22px] leading-7">{title}</h2>
          <p className="mt-2 max-w-[46ch] text-[15px] leading-[1.5] text-muted-foreground">{description}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            {action}
            <span data-slot="settings-guide-secondary" className="contents">
              {secondaryAction}
            </span>
          </div>
        </div>
        {facts.length > 0 && (
          <ul className="flex flex-col gap-4">
            {facts.map((fact, index) => (
              <li key={index} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-background ring-1 ring-foreground/10 [&_svg]:size-4"
                >
                  {fact.icon}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{fact.title}</span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground leading-normal">
                    {fact.description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
