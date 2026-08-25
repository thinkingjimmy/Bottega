"use client";

/**
 * [INPUT]: Depends on React, lucide ChevronDown and ui sidebar/collapsible; Receive controls, group names, operate render slots and content
 * [OUTPUT]: Provides SidebarCollapsibleGroup with SIDEBAR_GROUP_LABEL_CLASS_NAME, a unified Library/Activity group headings view, and the arrows, hover/keyboard appearance and content skeleton of the folding group
 * [POS]: The Sidebar of components is a visual native language for grouping; Title tokens are maintained with all named hover classes at this single point, with consumers providing only action and content
 */

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@ai-chat/ui/components/ui/sidebar";

type GroupName = "projects-header" | "bases-header" | "chats-header";

export const SIDEBAR_GROUP_LABEL_CLASS_NAME =
  "font-medium! text-sidebar-foreground/35!";

const actionBase =
  "pointer-events-none top-1.5 right-1 cursor-pointer text-sidebar-foreground/35 opacity-0 transition-opacity aria-expanded:pointer-events-auto aria-expanded:opacity-100";

const groupStyles: Record<
  GroupName,
  { container: string; chevron: string; action: string }
> = {
  "projects-header": {
    container: "group/projects-header relative",
    chevron:
      "group-hover/projects-header:opacity-100 group-has-[:focus-visible]/projects-header:opacity-100",
    action: `${actionBase} group-hover/projects-header:pointer-events-auto group-hover/projects-header:opacity-100 group-has-[:focus-visible]/projects-header:opacity-100`,
  },
  "bases-header": {
    container: "group/bases-header relative",
    chevron:
      "group-hover/bases-header:opacity-100 group-has-[:focus-visible]/bases-header:opacity-100",
    action: `${actionBase} group-hover/bases-header:pointer-events-auto group-hover/bases-header:opacity-100 group-has-[:focus-visible]/bases-header:opacity-100`,
  },
  "chats-header": {
    container: "group/chats-header relative",
    chevron:
      "group-hover/chats-header:opacity-100 group-has-[:focus-visible]/chats-header:opacity-100",
    action: `${actionBase} group-hover/chats-header:pointer-events-auto group-hover/chats-header:opacity-100 group-has-[:focus-visible]/chats-header:opacity-100`,
  },
};

export function SidebarCollapsibleGroup({
  label,
  groupName,
  open,
  onOpenChange,
  actions,
  children,
}: {
  label: string;
  groupName: GroupName;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions?: (actionClassName: string) => ReactNode;
  children: ReactNode;
}) {
  const styles = groupStyles[groupName];
  return (
    <Collapsible asChild open={open} onOpenChange={onOpenChange}>
      <SidebarGroup className="px-0.5 py-0.25">
        <div className={styles.container}>
          <SidebarGroupLabel
            asChild
            className={SIDEBAR_GROUP_LABEL_CLASS_NAME}
          >
            <CollapsibleTrigger className="cursor-pointer">
              {label}
              <ChevronDown
                aria-hidden
                className={`ml-2 opacity-0 transition-[transform,opacity] ${styles.chevron} ${
                  open ? "" : "-rotate-90"
                }`}
              />
            </CollapsibleTrigger>
          </SidebarGroupLabel>
          {actions?.(styles.action)}
        </div>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
