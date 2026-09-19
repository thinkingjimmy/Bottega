/**
 * [INPUT]: Host-owned links, active state, identity marks and trailing actions.
 * [OUTPUT]: Shared root/Project leaf rows and in-list Show more controls.
 * [POS]: Leaf geometry for the complete workspace sidebar.
 */
import type { ReactElement, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "../../ui/sidebar";
import { SidebarRowMark, SidebarRowTitle, sidebarSubRowClass } from "../row";
export function WorkspaceNavigationItem({
  title,
  mark,
  active,
  nested = false,
  render,
  trailing,
  actions,
}: {
  title: string;
  mark: ReactNode;
  active: boolean;
  nested?: boolean;
  render(children: ReactNode): ReactElement;
  trailing?: ReactNode;
  actions?: ReactNode;
}) {
  const content = render(
    <>
      <SidebarRowMark>{mark}</SidebarRowMark>
      <SidebarRowTitle>{title}</SidebarRowTitle>
      {trailing}
    </>,
  );
  return nested ? (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        asChild
        isActive={active}
        className={sidebarSubRowClass}
      >
        {content}
      </SidebarMenuSubButton>
      {actions}
    </SidebarMenuSubItem>
  ) : (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} className={actions ? "font-normal! group-has-data-[sidebar=menu-action]/menu-item:pr-2 group-hover/menu-item:bg-sidebar-accent group-has-[:focus-visible]/menu-item:bg-sidebar-accent" : undefined}>
        {content}
      </SidebarMenuButton>
      {actions}
    </SidebarMenuItem>
  );
}
export function WorkspaceNavigationMore({
  label,
  nested = false,
  disabled,
  onClick,
}: {
  label: string;
  nested?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  const content = (
    <button type="button" disabled={disabled} onClick={onClick}>
      <SidebarRowMark>
        <ChevronDown aria-hidden />
      </SidebarRowMark>
      <span>{label}</span>
    </button>
  );
  return nested ? (
    <SidebarMenuSubItem className="w-full">
      <SidebarMenuSubButton
        asChild
        className={`${sidebarSubRowClass} cursor-pointer text-sidebar-foreground/55`}
      >
        {content}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  ) : (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="cursor-pointer text-sidebar-foreground/55"
      >
        {content}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
