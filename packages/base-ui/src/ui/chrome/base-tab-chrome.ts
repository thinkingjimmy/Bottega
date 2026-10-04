/**
 * [INPUT]: Depends only on the cn utility; deliberately avoids any Radix/component import so it stays safe to load as a static module before DOM tests set up jsDOM globals
 * [OUTPUT]: Provides baseTabShellClass(active) with baseTabActionButtonClass (the same set of tabs shared between the host tab and the view tab) and baseMenuItemHoverClass for Base dropdown items
 * [POS]: Shared Base presentation in ui/chrome.
 */

import { cn } from "@ai-chat/ui/lib/utils";

export const baseMenuItemHoverClass =
  "focus:bg-muted focus:text-foreground not-data-[variant=destructive]:focus:**:text-inherit";

export function baseTabShellClass(active: boolean) {
  return cn(
    "group/tab-chrome flex max-w-40 cursor-pointer items-center rounded-md pr-1 pl-2 text-xs transition-colors",
    active
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/50"
  );
}

// no-hover keeps the menu reachable on touch, where it is the only rename/delete path; the invisible 44px hit area leaves the 16px glyph alone.
export const baseTabActionButtonClass =
  "relative touch-target-44 cursor-pointer rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/tab-chrome:opacity-100 data-[state=open]:opacity-100 no-hover:opacity-100 pointer-coarse:p-1.5 disabled:pointer-events-none";
