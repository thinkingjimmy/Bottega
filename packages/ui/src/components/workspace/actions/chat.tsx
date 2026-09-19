/**
 * [INPUT]: Host copy, archive preference, busy state and rename/archive callbacks.
 * [OUTPUT]: Shared Chat More menu and archive quick action with keyboard/pointer focus handoff.
 * [POS]: Root and Project row actions consumed by Cloud Web and Electron.
 */
import { useState } from "react";
import { Archive, MoreHorizontal, Pencil } from "lucide-react";
import { ConfettiIcon } from "@phosphor-icons/react/Confetti";
import { SidebarMenuAction } from "../../ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { sidebarRootMenuActionClass } from "../row";
import { useSidebarRenameMenu } from "./rename";

const subActionClass = "pointer-events-none opacity-0 cursor-pointer text-sidebar-foreground/35 hover:bg-transparent hover:text-sidebar-foreground focus-visible:text-sidebar-foreground aria-expanded:text-sidebar-foreground group-has-[:focus-visible]/menu-sub-item:pointer-events-auto group-has-[:focus-visible]/menu-sub-item:opacity-100 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 aria-expanded:pointer-events-auto aria-expanded:opacity-100";

export function ChatRowActions({ nested = false, confetti, disabled, copy, onArchive, renameMenu }: {
  nested?: boolean;
  confetti: boolean;
  disabled?: boolean;
  copy: { more: string; rename: string; archive: string; archiveChat: string; archiveHint: string };
  onArchive(): void;
  renameMenu: ReturnType<typeof useSidebarRenameMenu>;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  if (!confetti && tooltipOpen) setTooltipOpen(false);
  const actionClass = nested ? subActionClass : sidebarRootMenuActionClass;
  return <>
    <Tooltip open={confetti && tooltipOpen} onOpenChange={open => setTooltipOpen(confetti && open)}>
      <TooltipTrigger asChild>
        <SidebarMenuAction type="button" data-chat-row-action="archive" showOnHover={!nested}
          className={actionClass} aria-label={copy.archiveChat} disabled={disabled} onClick={onArchive}>
          {confetti ? <ConfettiIcon weight="regular" aria-hidden data-archive-icon="confetti" /> : <Archive aria-hidden data-archive-icon="archive" />}
        </SidebarMenuAction>
      </TooltipTrigger>
      {confetti && <TooltipContent side="top">{copy.archiveHint}</TooltipContent>}
    </Tooltip>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction {...renameMenu.triggerProps} type="button" data-chat-row-action="more" showOnHover={!nested}
          className={`right-7 ${actionClass}`} aria-label={copy.more} disabled={disabled}>
          <MoreHorizontal />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-max min-w-0" onCloseAutoFocus={renameMenu.onMenuCloseAutoFocus}>
        <DropdownMenuItem className="whitespace-nowrap" onSelect={renameMenu.requestOpen}>
          <Pencil />{copy.rename}
        </DropdownMenuItem>
        <DropdownMenuItem className="whitespace-nowrap" disabled={disabled} onSelect={onArchive}>
          <Archive />{copy.archive}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}
