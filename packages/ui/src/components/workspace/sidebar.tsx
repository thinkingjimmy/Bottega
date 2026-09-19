/**
 * [INPUT]: Shared sidebar primitives and host-provided content.
 * [OUTPUT]: WorkspaceSidebar and common sidebar typography.
 * [POS]: Persistent navigation geometry shared by both product hosts.
 */
import type { ComponentProps } from "react";
import { Sidebar } from "../ui/sidebar";
import { cn } from "../../lib/utils";
const workspaceSidebarTypography = "[&_[data-slot=sidebar-group-label]]:text-sm [&_[data-sidebar=menu-button]]:h-8 [&_[data-sidebar=menu-button]]:font-normal! [&_[data-sidebar=menu-button]]:text-sm [&_[data-sidebar=menu-button]]:leading-5 [&_[data-sidebar=menu-sub-button]]:h-8 [&_[data-sidebar=menu-sub-button]]:font-normal! [&_[data-sidebar=menu-sub-button]]:text-sm [&_[data-sidebar=menu-sub-button]]:leading-5 [&_[data-sidebar=menu-button]_svg]:[stroke-width:1.5] max-md:[&_[data-sidebar=menu-button]]:min-h-11 max-md:[&_[data-sidebar=menu-sub-button]]:min-h-11 max-md:[&_[data-slot=sidebar-group-label]]:min-h-11 pointer-coarse:[&_[data-sidebar=menu-button]]:min-h-11 pointer-coarse:[&_[data-sidebar=menu-sub-button]]:min-h-11";
export function WorkspaceSidebar({ className, ...props }: ComponentProps<typeof Sidebar>) {
  return <Sidebar variant="inset" className={cn(workspaceSidebarTypography, className)} {...props} />;
}
