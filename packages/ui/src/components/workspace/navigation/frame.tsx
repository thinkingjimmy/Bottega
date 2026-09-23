/**
 * [INPUT]: Navigation destinations, metadata section models, host actions and optional native window chrome.
 * [OUTPUT]: WorkspaceNavigation owns the complete brand/header, the computer strip above the groups, primary routes, ordered groups or the sentence that replaces them, settings footer and resize rail, live or inert, as the sidebar or as a phone home page.
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
import { COMPUTER_PANEL_ID } from "../../account/computer-switcher";

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
  /** The account's computer strip, pinned under the primary routes so the viewed computer never scrolls away. */
  computers?: ReactNode;
  /** Replaces the groups while the account has no computer: there is no sidebar to show until one signs in. */
  noComputers?: ReactNode;
  appsExtras?: ReactNode;
  footerActions?: ReactNode;
  chrome?: ReactNode;
  replacement?: ReactNode;
  showToggle?: boolean;
  /** A waiting host draws the same chrome with nothing behind it: header controls keep their shape but take no focus and no clicks. */
  inert?: boolean;
  /**
   * "page" draws the same groups as a phone's home page: in flow at full width, no drawer, toggle or resize rail, the
   * computer strip first, and no New chat row — the host puts its own creation control in `footerActions`.
   */
  surface?: "sidebar" | "page";
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
  computers,
  noComputers,
  appsExtras,
  footerActions,
  chrome,
  replacement,
  showToggle = true,
  inert = false,
  surface = "sidebar",
  width,
  onWidthChange,
  onMobileCloseAutoFocus,
  children,
}: WorkspaceNavigationProps) {
  const sidebar = useSidebar();
  const still = inert ? { "aria-disabled": true, tabIndex: -1 } : null;
  const page = surface === "page";
  return (
    <WorkspaceSidebar
      {...(page
        ? { collapsible: "none" as const, className: "min-h-0 w-full flex-1", "data-workspace-navigation-surface": "page" }
        : { onMobileCloseAutoFocus })}
    >
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
            {!page && (showToggle || sidebar.isMobile) && (
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
          {page && computers}
          <SidebarMenu>
            {!page && (
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
            )}
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
          {!page && computers}
        </SidebarHeader>
        <SidebarContent>
          <div
            data-sidebar-library-panel
            id={COMPUTER_PANEL_ID}
            aria-hidden={activity?.active ? true : undefined}
            className={activity?.active ? "hidden" : "contents"}
          >
            {noComputers ?? (
              <>
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
              </>
            )}
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
      {!page && (
        <SidebarRail
          resizable
          width={width}
          minWidth={WORKSPACE_SIDEBAR_MIN_WIDTH}
          maxWidth={WORKSPACE_SIDEBAR_MAX_WIDTH}
          onWidthChange={onWidthChange}
        />
      )}
      {children}
    </WorkspaceSidebar>
  );
}
