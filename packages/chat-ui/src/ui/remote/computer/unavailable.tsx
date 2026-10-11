/**
 * [INPUT]: Shared buttons, menus, spinner, connection copy and accessible status icons.
 * [OUTPUT]: RemoteUnavailable and RemoteConnectionUnavailable replace the editor with one status and consistent outline pill actions.
 * [POS]: Composer replacement for blocked access, disconnected computers and recovery; parent stores retain drafts and command custody.
 */
import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, Monitor, WifiOff } from "lucide-react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { computerCopy } from "@ai-chat/ui/components/feedback/computer-copy";
import type { OwnerBlock } from "../composer/status";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
export type UnavailableAction = { label: string; icon?: ReactNode; disabled?: boolean; outline?: boolean } & ({ run(): void; menu?: undefined } | { menu: ReactNode; run?: undefined });
export function RemoteUnavailable({ icon, title, description, actions = [] }: { icon?: ReactNode; title: string; description?: string; actions?: UnavailableAction[] }) {
  return <div role="status" aria-live="polite" className="chat-remote-unavailable">
    {icon}
    <div className="chat-remote-unavailable-body">
      <p className="chat-remote-unavailable-title">{title}</p>
      {description && <p className="chat-remote-unavailable-description">{description}</p>}
      {actions.length > 0 && <div className="chat-remote-unavailable-actions">{actions.map(action => action.menu
        ? <DropdownMenu key={action.label}><DropdownMenuTrigger asChild disabled={action.disabled}><ActionButton action={action} /></DropdownMenuTrigger>{action.menu}</DropdownMenu>
        : <ActionButton key={action.label} action={action} />)}</div>}
    </div>
  </div>;
}
/* A menu trigger arrives through Slot: its handler opens the menu, the action's own disabled state stays. */
function ActionButton({ action, onClick, ...trigger }: { action: UnavailableAction } & ComponentProps<typeof Button>) {
  return <Button {...trigger} type="button" size="pill" variant="outline" disabled={action.disabled} onClick={action.run ?? onClick}>
    {action.icon}{action.label}{action.menu && <ChevronDown aria-hidden="true" data-icon="inline-end" />}
  </Button>;
}
/** Temporary covers leave draft and command custody mounted in the parent. */
export function RemoteConnectionUnavailable({ locale, block, loading = false, actions }: { locale: string; block?: OwnerBlock | null; loading?: boolean; actions?: UnavailableAction[] }) {
  const copy = computerCopy(locale), waiting = loading || block?.loading;
  return <RemoteUnavailable icon={waiting ? <Spinner aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : block ? <Monitor aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
    title={waiting ? copy.loading : block ? block.title ?? block.reason : copy.disconnected}
    description={waiting ? undefined : block ? block.title ? block.reason : block.hint ?? undefined : copy.disconnectedBody} actions={actions} />;
}
