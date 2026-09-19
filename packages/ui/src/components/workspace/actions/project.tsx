/**
 * [INPUT]: Host capabilities, menu items, copy and focus callbacks.
 * [OUTPUT]: ProjectRowMenu and the canonical Project action class.
 * [POS]: Shared native/Web Project menu; filesystem and lifecycle commands stay in host adapters.
 */
import type { ReactNode } from "react";
import { MoreHorizontal, Pencil, Settings } from "lucide-react";
import { SidebarMenuAction } from "../../ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";
import { useSidebarRenameMenu } from "./rename";

export const projectRowActionClass = "pointer-events-none cursor-pointer opacity-0 text-sidebar-foreground/35 peer-hover/menu-button:text-sidebar-foreground/35 group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 group-has-[:focus-visible]/project-row:pointer-events-auto group-has-[:focus-visible]/project-row:opacity-100 hover:bg-transparent hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:text-sidebar-foreground aria-expanded:pointer-events-auto aria-expanded:opacity-100 aria-expanded:text-sidebar-foreground disabled:cursor-default disabled:hover:text-sidebar-foreground/35 disabled:focus-visible:text-sidebar-foreground/35";

export function ProjectRowMenu({ copy, renameMenu, onSettings, editable = true, disabled, className, children }: {
  copy: { more: string; rename: string; settings: string };
  renameMenu: ReturnType<typeof useSidebarRenameMenu>;
  onSettings(): void;
  editable?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuAction {...renameMenu.triggerProps} type="button" data-project-row-action="more"
        className={`${projectRowActionClass} ${className ?? ""}`} aria-label={copy.more} disabled={disabled}>
        <MoreHorizontal />
      </SidebarMenuAction>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="bottom" align="start" className="w-max min-w-0" onCloseAutoFocus={renameMenu.onMenuCloseAutoFocus}>
      {editable && <>
        <DropdownMenuItem onSelect={renameMenu.requestOpen}><Pencil />{copy.rename}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings}><Settings />{copy.settings}</DropdownMenuItem>
      </>}
      {children}
    </DropdownMenuContent>
  </DropdownMenu>;
}
