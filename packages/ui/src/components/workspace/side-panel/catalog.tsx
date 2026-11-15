/**
 * [INPUT]: Host-translated catalog entries, capability predicates and commands that receive their launch button.
 * [OUTPUT]: SidePanelCatalog and SidePanelAddMenu with hover and focus feedback and readable disabled reasons.
 * [POS]: Canonical panel directory presentation shared by desktop and Web.
 */
import { PlusIcon, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../ui/controls/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/overlays/dropdown-menu";
import { cn } from "../../../lib/utils";
import { panelChromeClassName } from "../page";
export type PanelCatalogItem<Id extends string = string> = { id: Id; label: string; hint: string; icon: LucideIcon; menuHint?: boolean };
type Props<Id extends string> = {
  items: readonly PanelCatalogItem<Id>[]; disabledFor(id: Id): boolean; disabledReasonFor?(id: Id): string | undefined;
  onOpen(id: Id, trigger: HTMLButtonElement): void; accessibleLabel?(item: PanelCatalogItem<Id>, reason?: string): string;
};
export function SidePanelAddMenu<Id extends string>({ items, disabledFor, disabledReasonFor, onOpen, accessibleLabel, label, fullLabel }: Props<Id> & { label: string; fullLabel: string }) {
  const full = items.every(item => disabledFor(item.id));
  const trigger = useRef<HTMLButtonElement>(null);
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button ref={trigger} aria-label={label} className={cn("shrink-0 cursor-pointer text-muted-foreground", panelChromeClassName)} disabled={full} size="icon-lg" title={full ? fullLabel : label} type="button" variant="ghost"><PlusIcon /></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-40">
    {items.map(item => { const disabled = disabledFor(item.id), reason = disabledReasonFor?.(item.id), Icon = item.icon;
      return <DropdownMenuItem key={item.id} aria-disabled={disabled || undefined} aria-label={reason ? accessibleLabel?.(item, reason) : undefined}
        className={cn("min-h-11", disabled ? "cursor-not-allowed opacity-55" : "hover:bg-accent")} onSelect={event => { if (disabled) event.preventDefault(); else if (trigger.current) onOpen(item.id, trigger.current); }}>
        <Icon /><span className="min-w-0"><span className="block">{item.label}</span>{(reason || item.menuHint) && <span className="block text-muted-foreground text-xs">{reason ?? item.hint}</span>}</span>
      </DropdownMenuItem>;
    })}
  </DropdownMenuContent></DropdownMenu>;
}
export function SidePanelCatalog<Id extends string>({ items, disabledFor, disabledReasonFor, onOpen, accessibleLabel }: Props<Id>) {
  return <div className="flex min-h-0 flex-1 overflow-y-auto px-5 py-4"><div className="m-auto flex w-full max-w-72 flex-col gap-1">
    {items.map(item => { const disabled = disabledFor(item.id), reason = disabledReasonFor?.(item.id), Icon = item.icon;
      return <button key={item.id} aria-disabled={disabled || undefined} aria-label={accessibleLabel?.(item, disabled ? reason : undefined)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
          disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-accent active:bg-muted"
        )}
        onClick={event => { if (!disabled) onOpen(item.id, event.currentTarget); }} type="button">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.label}</span><span className="block text-[11px] leading-4 text-muted-foreground">{reason ?? item.hint}</span></span>
      </button>;
    })}
  </div></div>;
}
