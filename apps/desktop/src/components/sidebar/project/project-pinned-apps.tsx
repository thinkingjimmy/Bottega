"use client";

/**
 * [INPUT]: Depends on shared appDisplayName, a Project placement projection, AppsProvider records, the exclusive Sidebar App target, shared Sidebar App activation, router, and Sidebar sub-row primitives
 * [OUTPUT]: Provides ordered Project App aliases with renderer/main generation-fenced canonical activation and no management actions
 * [POS]: Focused Project child-list projection inserted between Project Base and Chat/History rows
 */

import { appDisplayName } from "../../../../shared/apps-ipc";
import { useNavigate } from "react-router";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import type { Project } from "../../../../shared/projects-ipc";
import { useApps } from "@/components/providers/apps-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { sidebarSubRowClass, SidebarRowMark } from "@ai-chat/ui/components/workspace/row";
import { activateSidebarApp } from "../apps/activate-app-surface";
import { useSidebarAppTarget } from "../active/app-target";

export function ProjectPinnedApps({
  project,
  expanded = true,
}: {
  project: Project;
  expanded?: boolean;
}) {
  const navigate = useNavigate();
  const { records } = useApps();
  const target = useSidebarAppTarget();
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const aliases = [...project.appPlacements]
    .sort(
      (left, right) =>
        left.pinnedAt - right.pinnedAt || left.appId.localeCompare(right.appId)
    )
    .flatMap((placement) => {
      const record = recordsById.get(placement.appId);
      return record ? [{ placement, record }] : [];
    });

  return aliases.map(({ placement, record }) => {
    const name = appDisplayName(record);
    const icon = record.manifest?.icon ?? "📦";
    const active =
      expanded &&
      target.kind === "project-app" &&
      target.projectId === project.id &&
      target.appId === record.id;
    const activate = () =>
      activateSidebarApp(record, {
        navigate,
        onError: (cause) => toast.error(errorMessage(cause)),
        origin: { projectId: project.id },
      });
    return (
      <SidebarMenuSubItem
        className="w-full"
        key={`${project.id}:${placement.appId}`}
      >
        <SidebarMenuSubButton
          asChild
          className={`${sidebarSubRowClass} cursor-pointer`}
          isActive={active}
        >
          <button
            aria-label={name}
            data-project-app-id={record.id}
            data-project-id={project.id}
            onClick={() => void activate()}
            type="button"
          >
            <SidebarRowMark>
              <span aria-hidden className="text-[13px] leading-none">
                {icon}
              </span>
            </SidebarRowMark>
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  });
}
