"use client";

/**
 * [INPUT]: Depends on a Project placement projection, AppsProvider records, exclusive Sidebar App target/origin state, shared activation, router, and Sidebar sub-row primitives
 * [OUTPUT]: Provides ordered Project App aliases with renderer/main generation-fenced canonical activation and no management actions
 * [POS]: Focused Project child-list projection inserted between Project Base and Chat/History rows
 */

import { useNavigate } from "react-router";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import {
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import type { Project } from "../../../../shared/projects-ipc";
import { useApps } from "@/components/providers/apps-provider";
import { errorMessage } from "@/lib/errors";
import { sidebarSubRowClass, SidebarRowMark } from "../sidebar-row";
import { activateAppSurface } from "../apps/activate-app-surface";
import { sidebarAppOriginStore } from "../active/app-origin";
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
    const name = record.manifest?.name ?? record.displayName ?? record.id;
    const icon = record.manifest?.icon ?? "📦";
    const active =
      expanded &&
      target.kind === "project-app" &&
      target.projectId === project.id &&
      target.appId === record.id;
    const activate = async () => {
      const activation = sidebarAppOriginStore.beginActivation(record.id);
      try {
        await activation.ready;
      } catch (cause) {
        sidebarAppOriginStore.finishNavigation(activation.epoch);
        toast.error(errorMessage(cause));
        return;
      }
      if (!sidebarAppOriginStore.isCurrent(activation.epoch)) return;
      const result = await activateAppSurface(record, {
        navigate,
        navigationIntentId: activation.intentId,
        onError: (cause) => toast.error(errorMessage(cause)),
      });
      if (
        result.outcome === "main-shown" ||
        result.outcome === "fallback-main"
      ) {
        sidebarAppOriginStore.commitActivation(activation.epoch, {
          appId: record.id,
          projectId: project.id,
        });
      } else {
        sidebarAppOriginStore.finishNavigation(activation.epoch);
      }
    };
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
