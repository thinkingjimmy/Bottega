/**
 * [INPUT]: Host-owned section state, localized loading/empty copy and metadata row slots.
 * [OUTPUT]: NavigationSectionModel, WorkspaceNavigationSection and shared loading rows.
 * [POS]: Section presentation used by the complete desktop and browser sidebar.
 */
import type { ReactNode } from "react";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "../../ui/sidebar";
import { SidebarCollapsibleGroup } from "../group";

export type NavigationSectionModel = {
  label: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  actions?: (className: string) => ReactNode;
  pending?: boolean;
  loadingLabel?: string;
  empty?: boolean;
  emptyLabel?: string;
  content: ReactNode;
};
const widths = ["72%", "88%", "58%"];
export function WorkspaceNavigationLoading({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  if (rows <= 0) return null;
  return (
    <div aria-busy="true" data-sidebar-loading-rows="" role="status">
      <span className="sr-only">{label}</span>
      <SidebarMenu>
        {Array.from({ length: rows }, (_, index) => (
          <SidebarMenuItem key={index}>
            <SidebarMenuSkeleton
              showIcon
              width={widths[index % widths.length]}
            />
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </div>
  );
}
export function WorkspaceNavigationSection({
  groupName,
  ...section
}: NavigationSectionModel & {
  groupName: "projects-header" | "bases-header" | "chats-header";
}) {
  return (
    <SidebarCollapsibleGroup
      groupName={groupName}
      label={section.label}
      open={section.open}
      onOpenChange={section.onOpenChange}
      actions={section.actions}
    >
      {section.pending ? (
        <WorkspaceNavigationLoading
          label={section.loadingLabel ?? section.label}
        />
      ) : (
        <>
          {section.content}
          {section.empty && section.emptyLabel && (
            <p className="px-2 py-1.5 text-muted-foreground text-xs">
              {section.emptyLabel}
            </p>
          )}
        </>
      )}
    </SidebarCollapsibleGroup>
  );
}
