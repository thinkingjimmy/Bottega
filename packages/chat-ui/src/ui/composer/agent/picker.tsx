/**
 * [INPUT]: Host-projected availability rows, quota summaries, recovery actions and controlled menu state.
 * [OUTPUT]: One Agent picker view for native and remote Chat.
 * [POS]: The composer's Agent surface over quota/; presentation only, each platform owns discovery, quota demand and recovery authority.
 */
import type { ReactNode, Ref, HTMLAttributes } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
type Backend = "codex" | "claude" | "kimi" | "opencode";
export type AgentPickerRow = { id: Backend; name: string; current: boolean; choosable: boolean; inert: boolean; dim: boolean;
  tone: "quiet" | "working" | "attention"; verb?: string; label: string; description: string; line: ReactNode; peek?: boolean;
  handlers?: HTMLAttributes<HTMLElement>; select(event: Event): void };
export function AgentPicker({ value, open, onOpenChange, triggerRef, menuRef, label, busy, tone, tooltip, prefetch, rows, descriptionId, heading, footer, announcement, onEscapeKeyDown, onCloseAutoFocus, disabled }: {
  value: Backend; open: boolean; onOpenChange(open: boolean): void; triggerRef?: Ref<HTMLButtonElement>; menuRef?: Ref<HTMLDivElement>;
  label: string; busy?: boolean; disabled?: boolean; tone: AgentPickerRow["tone"]; tooltip: ReactNode; prefetch?(): void;
  rows: AgentPickerRow[]; descriptionId: string; heading?: ReactNode; footer?: ReactNode; announcement?: string;
  onEscapeKeyDown?(event: KeyboardEvent): void; onCloseAutoFocus?(event: Event): void;
}) {
  return <><DropdownMenu open={open} onOpenChange={onOpenChange}><TooltipProvider><Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild>
    <Button ref={triggerRef} type="button" variant="ghost" disabled={disabled} aria-label={label} aria-busy={busy} onPointerEnter={prefetch} onFocus={prefetch} className="h-8 shrink-0 gap-1.5 rounded-full px-2">
      {tone === "working" ? <span className="relative flex size-5 shrink-0 items-center justify-center"><AgentBackendIcon backend={value} className="size-3.5" /><span aria-hidden="true" className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-border border-t-muted-foreground motion-reduce:animate-none" /></span> : <AgentBackendIcon backend={value} className="size-4" />}
      {tone === "attention" && <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
    </Button>
  </DropdownMenuTrigger></TooltipTrigger><TooltipContent className="max-w-64">{tooltip}</TooltipContent></Tooltip></TooltipProvider>
    <DropdownMenuContent ref={menuRef} side="top" align="end" className="w-76 min-w-0 max-w-[calc(100vw-1rem)]" data-testid="agent-usage-menu" onEscapeKeyDown={onEscapeKeyDown} onCloseAutoFocus={onCloseAutoFocus}>
      {heading}<DropdownMenuRadioGroup value={value}>{rows.map(row => <DropdownMenuItem key={row.id} role={row.choosable ? "menuitemradio" : "menuitem"} aria-checked={row.choosable ? row.current : undefined} disabled={row.inert}
        aria-label={row.label} aria-describedby={`${descriptionId}-${row.id}`} data-agent={row.id} data-peek={row.peek ? "" : undefined} {...row.handlers} onSelect={row.select}
        className="min-h-[50px] items-center gap-2.5 px-2.5 py-1.5 data-disabled:opacity-100 data-peek:bg-accent data-peek:text-accent-foreground data-peek:**:text-accent-foreground">
        <AgentBackendIcon backend={row.id} className={`size-4 shrink-0 [&>svg]:size-full! ${row.dim ? "[&>svg]:opacity-60" : ""}`} />
        <div className="min-w-0 flex-1"><div className={`flex min-h-4 items-center leading-4 font-medium ${row.dim ? "text-muted-foreground" : ""}`}>{row.name}</div>
          <div className={`mt-0.5 text-[11px] leading-4 tabular-nums ${row.tone === "attention" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`agent-line-${row.id}`}>{row.line}</div></div>
        <span className="flex h-4 shrink-0 items-center justify-end self-start">{row.tone === "working" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" /> : row.verb ? <span className="text-[11px] font-medium whitespace-nowrap">{row.verb}</span> : row.current ? <Check aria-hidden="true" className="size-3.5" /> : null}</span>
        <span id={`${descriptionId}-${row.id}`} hidden>{row.description}</span>
      </DropdownMenuItem>)}</DropdownMenuRadioGroup>{footer}
    </DropdownMenuContent></DropdownMenu><span className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</span></>;
}
