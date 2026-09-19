/**
 * [INPUT]: Controlled Project expansion, localized title, appearance and platform action slots.
 * [OUTPUT]: WorkspaceProjectItem, Project child container, disclosure state, visibility predicate and shared page size.
 * [POS]: Complete Project row presentation consumed by native and browser navigation adapters.
 */
import { useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../ui/collapsible";
import {
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
} from "../../ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
const WORKSPACE_PROJECT_CHAT_PAGE_SIZE = 5;
export function workspaceProjectVisible(
  project: { role?: string; archivedAt?: number | null; appId: string | null },
  hasEditor: boolean,
) {
  return (
    project.role !== "base-custody" &&
    !project.archivedAt &&
    (project.appId === null || hasEditor)
  );
}
export function useWorkspaceProjectDisclosure() {
  const [open, setOpen] = useState(true),
    [limit, setLimit] = useState(WORKSPACE_PROJECT_CHAT_PAGE_SIZE);
  return {
    open,
    limit,
    onOpenChange(next: boolean) {
      setOpen(next);
      if (!next) setLimit(WORKSPACE_PROJECT_CHAT_PAGE_SIZE);
    },
    showMore() {
      setLimit((value) => value + WORKSPACE_PROJECT_CHAT_PAGE_SIZE);
    },
  };
}
export function WorkspaceProjectItem({
  name,
  open,
  onOpenChange,
  active,
  disabled,
  mark,
  details,
  actions,
  tooltip,
  children,
  dialogs,
}: {
  name: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  active: boolean;
  disabled?: boolean;
  mark: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
  tooltip?: ReactNode;
  children: ReactNode;
  dialogs?: ReactNode;
}) {
  return (
    <Collapsible asChild open={open} onOpenChange={onOpenChange}>
      <SidebarMenuItem>
        <div className="group/project-row relative">
          <div className="absolute top-1 left-1 flex size-6 items-center justify-center max-md:top-2.5 pointer-coarse:top-2.5">
            {mark}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <CollapsibleTrigger asChild disabled={disabled}>
                <SidebarMenuButton
                  isActive={active}
                  className={`cursor-pointer pl-8 group-hover/project-row:bg-sidebar-accent group-hover/project-row:text-sidebar-accent-foreground group-has-[:focus-visible]/project-row:bg-sidebar-accent group-has-[:focus-visible]/project-row:text-sidebar-accent-foreground ${disabled ? "text-muted-foreground opacity-65" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">
                    {name}
                  </span>
                  {details}
                </SidebarMenuButton>
              </CollapsibleTrigger>
            </TooltipTrigger>
            {tooltip && <TooltipContent side="right">{tooltip}</TooltipContent>}
          </Tooltip>
          {actions}
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-0 w-full translate-x-0 gap-px border-l-0 px-0">
            {children}
          </SidebarMenuSub>
        </CollapsibleContent>
        {dialogs}
      </SidebarMenuItem>
    </Collapsible>
  );
}
