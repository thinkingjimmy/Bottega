/**
 * [INPUT]: Shared sidebar primitives and controlled host layout state.
 * [OUTPUT]: WorkspaceProvider, WorkspaceInset and common sidebar bounds.
 * [POS]: Shared desktop and browser workspace frame.
 */
import type { ComponentProps } from "react";
import { SidebarProvider, SidebarInset } from "../ui/sidebar";
import { cn } from "../../lib/utils";
export const WORKSPACE_SIDEBAR_WIDTH = 256;
export const WORKSPACE_SIDEBAR_MIN_WIDTH = 200;
export const WORKSPACE_SIDEBAR_MAX_WIDTH = 400;
export function WorkspaceProvider({ className, ...props }: ComponentProps<typeof SidebarProvider>) {
  return <SidebarProvider className={cn("h-dvh min-h-0 overflow-hidden bg-sidebar", className)} {...props} />;
}
export function WorkspaceInset({ className, ...props }: ComponentProps<typeof SidebarInset>) {
  return <SidebarInset className={cn("relative h-dvh min-h-0 overflow-hidden border-border/80 md:h-[calc(100dvh-0.5rem)] md:rounded-xl md:border md:shadow-sm md:peer-data-[variant=inset]:m-1 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-1", className)} {...props} />;
}
