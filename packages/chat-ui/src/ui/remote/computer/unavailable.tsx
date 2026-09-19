/**
 * [INPUT]: Depends on the shared Button and dropdown-menu primitives and lucide's chevron and alert marks.
 * [OUTPUT]: Provides RemoteUnavailable — the read-only card that stands where the composer would be when this chat cannot send at all: an icon, a title, the reason and step, one outcome line and up to two actions (a filled one that gets the chat running, an outline one beside it), either of which may open a menu.
 * [POS]: The computer surface's replacement state (archived, remote control off, imported and not yet continued, a computer that cannot run); never rendered beside a live editor.
 */
import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
export type UnavailableAction = { label: string; icon?: ReactNode; disabled?: boolean; outline?: boolean } & ({ run(): void; menu?: undefined } | { menu: ReactNode; run?: undefined });
export function RemoteUnavailable({ icon, title, description, error, actions = [] }: { icon?: ReactNode; title: string; description?: string; error?: string | null; actions?: UnavailableAction[] }) {
  return <div role="status" className="chat-remote-unavailable">
    {icon}
    <div className="chat-remote-unavailable-body">
      <p className="chat-remote-unavailable-title">{title}</p>
      {description && <p className="chat-remote-unavailable-description">{description}</p>}
      {error && <p role="alert" className="chat-remote-unavailable-error"><TriangleAlert aria-hidden="true" className="size-3 shrink-0" />{error}</p>}
      {actions.length > 0 && <div className="chat-remote-unavailable-actions">{actions.map(action => action.menu
        ? <DropdownMenu key={action.label}><DropdownMenuTrigger asChild disabled={action.disabled}><ActionButton action={action} /></DropdownMenuTrigger>{action.menu}</DropdownMenu>
        : <ActionButton key={action.label} action={action} />)}</div>}
    </div>
  </div>;
}
/* A menu trigger arrives through Slot: its handler opens the menu, the action's own disabled state stays. */
function ActionButton({ action, onClick, ...trigger }: { action: UnavailableAction } & ComponentProps<typeof Button>) {
  return <Button {...trigger} type="button" size="sm" variant={action.outline ? "outline" : "default"} disabled={action.disabled} onClick={action.run ?? onClick}>
    {action.icon}{action.label}{action.menu && <ChevronDown aria-hidden="true" data-icon="inline-end" />}
  </Button>;
}
