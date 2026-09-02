"use client";

/**
 * [INPUT]: Depends on AppsProvider pinned records, exclusive App target/origin state, shared App activation, root-aligned Sidebar primitives, window intents, dropdown menu, and sonner
 * [OUTPUT]: Provides PinnedApps and route matching for exclusively active root App rows with generation-fenced activation, AppWindow, and direct Unpin
 * [POS]: components/sidebar/apps projection aligned with the parent Apps row; durable pin truth remains in the main-owned AppStore and App windows never own this management surface
 */

import { useState } from "react";
import { AppWindowIcon, MoreHorizontal, PinOff } from "lucide-react";
import { useNavigate } from "react-router";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@ai-chat/ui/components/ui/sidebar";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { useApps } from "@/components/providers/apps-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { openSurfaceInWindow } from "@/lib/window-surfaces-client";
import type { AppRecord } from "../../../../shared/apps-ipc";
import {
  appStudioSurface,
  canonicalAppSurfaceRoute,
} from "../../../../shared/window-surfaces-ipc";
import { useSidebarAppTarget } from "../active/app-target";
import { sidebarAppOriginStore } from "../active/app-origin";
import { activateAppSurface } from "./activate-app-surface";
import {
  SidebarRowMark,
  SidebarRowTitle,
  sidebarRootMenuActionClass,
} from "../sidebar-row";

const pinnedRowClass =
  "cursor-pointer pr-14 font-normal! group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground group-has-[:focus-visible]/menu-item:bg-sidebar-accent group-has-[:focus-visible]/menu-item:text-sidebar-accent-foreground";

export function isPinnedAppRoute(activePath: string, appId: string) {
  if (activePath.includes("#app-use:")) return false;
  return activePath === `/apps/${appId}` || activePath.startsWith(`/apps/${appId}/`);
}

export function PinnedApps() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const activeTarget = useSidebarAppTarget();
  const { pinnedRecords, setPinned } = useApps();
  const [busyId, setBusyId] = useState("");

  if (!pinnedRecords.length) return null;

  const showApp = async (record: AppRecord) => {
    const activation = sidebarAppOriginStore.beginActivation(record.id);
    try {
      await activation.ready;
    } catch (cause) {
      sidebarAppOriginStore.finishNavigation(activation.epoch);
      toast.error(errorMessage(cause));
      return;
    }
    if (!sidebarAppOriginStore.isCurrent(activation.epoch)) return;
    await activateAppSurface(record, {
      navigate,
      navigationIntentId: activation.intentId,
      onError: (cause) => toast.error(errorMessage(cause)),
    });
    sidebarAppOriginStore.finishNavigation(activation.epoch);
  };

  const openWindow = async (record: AppRecord) => {
    try {
      const result = await openSurfaceInWindow(
        appStudioSurface(record.id),
        record.id,
        canonicalAppSurfaceRoute(record.id)
      );
      if (!result) throw new Error(t("windowSurface.openInWindowUnavailable"));
    } catch (cause) {
      toast.error(t("windowSurface.openInWindowFailed"), {
        description: errorMessage(cause),
      });
    }
  };

  const unpin = async (record: AppRecord) => {
    setBusyId(record.id);
    try {
      await setPinned(record.id, false);
    } catch (cause) {
      toast.error(t("apps.pinFailed"), { description: errorMessage(cause) });
    } finally {
      setBusyId("");
    }
  };

  return (
    <SidebarMenuSub className="mx-0 w-full translate-x-0 gap-px border-l-0 px-0">
      {pinnedRecords.map((record) => (
        <PinnedAppRow
          active={
            activeTarget.kind === "global-app" &&
            activeTarget.appId === record.id
          }
          busy={busyId === record.id}
          key={record.id}
          onOpen={() => void showApp(record)}
          onOpenWindow={() => void openWindow(record)}
          onUnpin={() => void unpin(record)}
          record={record}
        />
      ))}
    </SidebarMenuSub>
  );
}

function PinnedAppRow({
  active,
  busy,
  onOpen,
  onOpenWindow,
  onUnpin,
  record,
}: {
  active: boolean;
  busy: boolean;
  onOpen(): void;
  onOpenWindow(): void;
  onUnpin(): void;
  record: AppRecord;
}) {
  const { t } = useAppTranslation();
  const menu = usePointerOpenedMenu();
  const name = record.manifest?.name ?? record.displayName;
  const icon = record.manifest?.icon ?? "📦";

  return (
    <SidebarMenuItem className="w-full">
      <SidebarMenuButton
        asChild
        className={pinnedRowClass}
        isActive={active}
      >
        <button
          aria-label={name}
          data-pinned-app-id={record.id}
          onClick={onOpen}
          type="button"
        >
          <SidebarRowMark>
            <span aria-hidden className="text-[13px] leading-none">
              {icon}
            </span>
          </SidebarRowMark>
          <SidebarRowTitle actionStrip="3.25rem">{name}</SidebarRowTitle>
        </button>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            {...menu.triggerProps}
            aria-label={`${name} · ${t("apps.menu")}`}
            className={`${sidebarRootMenuActionClass} right-7`}
            disabled={busy}
            showOnHover
          >
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-max min-w-0"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          <DropdownMenuItem disabled={busy} onSelect={onUnpin}>
            <PinOff />
            {t("apps.unpin")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SidebarMenuAction
        aria-label={`${t("windowSurface.openInWindow")} · ${name}`}
        className={sidebarRootMenuActionClass}
        disabled={busy}
        onClick={onOpenWindow}
        showOnHover
        title={t("windowSurface.openInWindow")}
      >
        <AppWindowIcon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
