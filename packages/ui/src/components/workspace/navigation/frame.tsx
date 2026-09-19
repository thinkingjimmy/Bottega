/**
 * [INPUT]: Navigation destinations, metadata section models, host actions and optional native window chrome.
 * [OUTPUT]: WorkspaceNavigation owns the complete brand/header, primary routes, ordered groups, settings footer and resize rail, live or inert.
 * [POS]: The single product sidebar view; Electron IPC, browser queries and routing stay in host adapters.
 */
import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  Bell,
  LayoutGrid,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
} from "lucide-react";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "../../ui/sidebar";
import { WorkspaceSidebar } from "../sidebar";
import { PRODUCT_LOGO_SIZE, PRODUCT_LOGO_URLS, PRODUCT_NAME } from "../brand";
import {
  WORKSPACE_SIDEBAR_MAX_WIDTH,
  WORKSPACE_SIDEBAR_MIN_WIDTH,
} from "../shell";
import {
  WorkspaceNavigationSection,
  type NavigationSectionModel,
} from "./section";

type NavigationDestination = {
  label: string;
  active?: boolean;
  render(children: ReactNode): ReactElement;
};
export type WorkspaceNavigationProps = {
  theme: "light" | "dark";
  newChat: NavigationDestination;
  apps: NavigationDestination;
  settings: NavigationDestination;
  search: { label: string; onClick(): void };
  toggleLabel: string;
  activity?: {
    label: string;
    active: boolean;
    onClick(): void;
    content: ReactNode;
  };
  sections: {
    projects: NavigationSectionModel;
    bases?: NavigationSectionModel | null;
    chats: NavigationSectionModel;
  };
  appsExtras?: ReactNode;
  footerActions?: ReactNode;
  chrome?: ReactNode;
  replacement?: ReactNode;
  showToggle?: boolean;
  /** A waiting host draws the same chrome with nothing behind it: header controls keep their shape but take no focus and no clicks. */
  inert?: boolean;
  width: number;
  onWidthChange(width: number): void;
  onMobileCloseAutoFocus?: ComponentProps<
    typeof WorkspaceSidebar
  >["onMobileCloseAutoFocus"];
  children?: ReactNode;
};
const headerAction =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/55 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:size-11 pointer-coarse:size-11";
export function WorkspaceNavigation({
  theme,
  newChat,
  apps,
  settings,
  search,
  toggleLabel,
  activity,
  sections,
  appsExtras,
  footerActions,
  chrome,
  replacement,
  showToggle = true,
  inert = false,
  width,
  onWidthChange,
  onMobileCloseAutoFocus,
  children,
}: WorkspaceNavigationProps) {
  const sidebar = useSidebar();
  const still = inert ? { "aria-disabled": true, tabIndex: -1 } : null;
  return (
    <WorkspaceSidebar onMobileCloseAutoFocus={onMobileCloseAutoFocus}>
      {chrome}
      {replacement}
      <div
        data-sidebar-app-panel
        aria-hidden={replacement ? true : undefined}
        className={replacement ? "hidden" : "contents"}
      >
        <SidebarHeader className="p-0.5 max-md:pt-[max(0.125rem,env(safe-area-inset-top))]">
          <div
            data-workspace-navigation-brand
            className="flex h-12 items-center pr-2 pl-2 max-md:h-14"
          >
            <img
              data-sidebar-brand-logo
              alt={PRODUCT_NAME}
              className="pointer-events-none h-8 w-auto min-w-0 shrink select-none object-contain object-left"
              decoding="sync"
              draggable={false}
              {...PRODUCT_LOGO_SIZE}
              src={PRODUCT_LOGO_URLS[theme]}
            />
            <button
              type="button"
              aria-label={search.label}
              className={`ml-auto ${headerAction}`}
              {...still}
              onClick={inert ? undefined : search.onClick}
            >
              <Search aria-hidden className="size-4" />
            </button>
            {activity && (
              <button
                type="button"
                aria-label={activity.label}
                aria-pressed={activity.active}
                className={`ml-1 ${headerAction} ${activity.active ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
                {...still}
                onClick={inert ? undefined : activity.onClick}
              >
                <Bell aria-hidden className="size-4" />
              </button>
            )}
            {(showToggle || sidebar.isMobile) && (
              <button
                type="button"
                aria-label={toggleLabel}
                className={`ml-1 ${headerAction}`}
                {...still}
                onClick={inert ? undefined : sidebar.toggleSidebar}
              >
                <PanelLeft aria-hidden className="size-4" />
              </button>
            )}
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={Boolean(newChat.active)}>
                {newChat.render(
                  <>
                    <SquarePen />
                    <span>{newChat.label}</span>
                  </>,
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={Boolean(apps.active)}>
                {apps.render(
                  <>
                    <LayoutGrid />
                    <span>{apps.label}</span>
                  </>,
                )}
              </SidebarMenuButton>
              {appsExtras}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <div
            data-sidebar-library-panel
            aria-hidden={activity?.active ? true : undefined}
            className={activity?.active ? "hidden" : "contents"}
          >
            <WorkspaceNavigationSection
              groupName="projects-header"
              {...sections.projects}
            />
            {sections.bases &&
              (!sections.bases.empty || sections.bases.pending) && (
                <WorkspaceNavigationSection
                  groupName="bases-header"
                  {...sections.bases}
                />
              )}
            <WorkspaceNavigationSection
              groupName="chats-header"
              {...sections.chats}
            />
          </div>
          {activity?.active && activity.content}
        </SidebarContent>
        <SidebarFooter className="p-0.5 max-md:pb-[max(0.125rem,env(safe-area-inset-bottom))]">
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center">
              <SidebarMenuButton
                asChild
                isActive={Boolean(settings.active)}
                className="w-auto flex-none cursor-pointer"
              >
                {settings.render(
                  <>
                    <Settings />
                    <span>{settings.label}</span>
                  </>,
                )}
              </SidebarMenuButton>
              {footerActions}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </div>
      <SidebarRail
        resizable
        width={width}
        minWidth={WORKSPACE_SIDEBAR_MIN_WIDTH}
        maxWidth={WORKSPACE_SIDEBAR_MAX_WIDTH}
        onWidthChange={onWidthChange}
      />
      {children}
    </WorkspaceSidebar>
  );
}
