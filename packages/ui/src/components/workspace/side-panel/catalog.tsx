/**
 * [INPUT]: Host-translated catalog entries and capability/duplicate predicates.
 * [OUTPUT]: SidePanelCatalog and SidePanelAddMenu with readable disabled reasons.
 * [POS]: Canonical four-card directory presentation shared by desktop and Web.
 */
import { PlusIcon, type LucideIcon } from "lucide-react";
import { Button } from "../../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { cn } from "../../../lib/utils";
import { panelChromeClassName } from "../page";
export type PanelCatalogItem = { id: string; label: string; hint: string; icon: LucideIcon; menuHint?: boolean };
type Props = {
  items: readonly PanelCatalogItem[]; disabledFor(id: string): boolean; disabledReasonFor?(id: string): string | undefined;
  onOpen(id: string): void; accessibleLabel?(item: PanelCatalogItem, reason?: string): string;
};
export function SidePanelAddMenu({ items, disabledFor, disabledReasonFor, onOpen, accessibleLabel, label, fullLabel }: Props & { label: string; fullLabel: string }) {
  const full = items.every(item => disabledFor(item.id));
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button aria-label={label} className={cn("shrink-0 cursor-pointer text-muted-foreground", panelChromeClassName)} disabled={full} size="icon-lg" title={full ? fullLabel : label} type="button" variant="ghost"><PlusIcon /></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-40">
    {items.map(item => { const disabled = disabledFor(item.id), reason = disabledReasonFor?.(item.id), Icon = item.icon;
      return <DropdownMenuItem key={item.id} aria-disabled={disabled || undefined} aria-label={reason ? accessibleLabel?.(item, reason) : undefined}
        className={cn("min-h-11", disabled && "cursor-not-allowed opacity-55")} onSelect={event => { if (disabled) event.preventDefault(); else onOpen(item.id); }}>
        <Icon /><span className="min-w-0"><span className="block">{item.label}</span>{(reason || item.menuHint) && <span className="block text-muted-foreground text-xs">{reason ?? item.hint}</span>}</span>
      </DropdownMenuItem>;
    })}
  </DropdownMenuContent></DropdownMenu>;
}
export function SidePanelCatalog({ items, disabledFor, disabledReasonFor, onOpen, accessibleLabel }: Props) {
  return <div className="grid min-h-0 flex-1 place-items-center px-5 py-6"><div className="flex w-full max-w-72 flex-col gap-1.5">
    {items.map(item => { const disabled = disabledFor(item.id), reason = disabledReasonFor?.(item.id), Icon = item.icon;
      return <button key={item.id} aria-disabled={disabled || undefined} aria-label={accessibleLabel?.(item, disabled ? reason : undefined)}
        className={cn("group/panel-card flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-foreground/15 hover:bg-accent", disabled && "cursor-not-allowed opacity-55")}
        onClick={() => { if (!disabled) onOpen(item.id); }} type="button">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground transition-colors group-hover/panel-card:text-foreground"><Icon className="size-3.5" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-sm">{item.label}</span><span className="block text-muted-foreground text-xs">{reason ?? item.hint}</span></span>
        <PlusIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/panel-card:opacity-100 no-hover:opacity-100" />
      </button>;
    })}
  </div></div>;
}
