/**
 * [INPUT]: Depends on host-normalized Effort options and shared dropdown primitives.
 * [OUTPUT]: Provides ModelEffortSubmenu with stable readonly and adjustable rows.
 * [POS]: Model menu presentation; hosts bind choices to models and own asynchronous commits.
 */
import { Skeleton } from "./skeleton";
import { SlimScroller } from "./slim-scroller";
import { DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "./dropdown-menu";
export function ModelEffortSubmenu({ label, value, selected, options, adjustable, disabled, pending, reason, onChange }: {
  label: string; value: string; selected?: string; options: readonly { id: string; label: string; description?: string }[];
  adjustable: boolean; disabled?: boolean; pending?: boolean; reason?: string; onChange(id: string): void;
}) {
  const face = <><span className="flex-1 font-medium">{label}</span>{pending ? <Skeleton className="h-3.5 w-20 rounded-full" /> : <span className="min-w-0 text-right text-muted-foreground"><span className="block truncate">{value}</span></span>}</>;
  if (!adjustable) return <div title={reason} className="flex min-h-8 items-center gap-2 rounded-lg px-2 py-2 text-sm">{face}<span className="size-3.5 shrink-0" aria-hidden="true" /></div>;
  return <DropdownMenuSub><DropdownMenuSubTrigger className="min-h-8 gap-2 rounded-lg py-2 text-sm">{face}</DropdownMenuSubTrigger>
    <DropdownMenuPortal><DropdownMenuSubContent sideOffset={8} collisionPadding={12} className="max-w-[min(20rem,100vw-2rem)]">
      <SlimScroller className="max-h-[min(16rem,calc(var(--radix-dropdown-menu-content-available-height)-0.5rem))] overflow-y-auto">
        <DropdownMenuRadioGroup value={selected ?? ""} onValueChange={onChange}>{options.map(option => <DropdownMenuRadioItem key={option.id} value={option.id} disabled={disabled} onSelect={event => event.preventDefault()} className="py-2 text-sm"><span className="min-w-0 flex-1"><span className="block truncate font-medium">{option.label}</span>{option.description && <span className="block truncate text-xs text-muted-foreground">{option.description}</span>}</span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
      </SlimScroller>
    </DropdownMenuSubContent></DropdownMenuPortal>
  </DropdownMenuSub>;
}
