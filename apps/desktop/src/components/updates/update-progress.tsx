/**
 * [INPUT]: Depends on a localized progress label, a percentage and shared class merging.
 * [OUTPUT]: Provides UpdateProgress with one accessible track shared by Sidebar and Settings.
 * [POS]: Shared renderer update presentation; lifecycle state remains in the update client.
 */

import { cn } from "@ai-chat/ui/lib/utils";

export function UpdateProgress({ percent, label, className }: {
  percent: number;
  label: string;
  className?: string;
}) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      className={cn("h-0.5 overflow-hidden rounded-full bg-foreground/10", className)}>
      <span className="block h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  );
}
