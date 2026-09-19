/**
 * [INPUT]: Shared CommandItem/CommandShortcut and host identity, content and actions.
 * [OUTPUT]: SearchRow with common native/Web title, snippet and trailing-slot geometry.
 * [POS]: Search result and quick-action presentation; the host owns selection effects.
 */
import type { ComponentProps, ReactNode } from "react";
import { CommandItem, CommandShortcut } from "../ui/command";
import { cn } from "../../lib/utils";
export function SearchRow({
  title,
  icon,
  snippet,
  trailing,
  className,
  ...props
}: Omit<ComponentProps<typeof CommandItem>, "children" | "title"> & {
  title: string;
  icon: ReactNode;
  snippet?: string;
  trailing?: ReactNode;
}) {
  return (
    <CommandItem
      {...props}
      className={cn(
        "max-md:min-h-11 pointer-coarse:min-h-11",
        snippet && "items-start",
        className,
      )}
    >
      <span className={snippet ? "mt-[3px] flex shrink-0" : "flex shrink-0"}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate" data-palette-title="">
          {title}
        </span>
        {snippet && (
          <span className="mt-0.5 line-clamp-2 block break-words text-[0.6875rem] text-muted-foreground">
            {snippet}
          </span>
        )}
      </span>
      <CommandShortcut className="flex max-w-[35%] shrink-0 items-center gap-1 truncate tracking-normal">
        {trailing}
      </CommandShortcut>
    </CommandItem>
  );
}
