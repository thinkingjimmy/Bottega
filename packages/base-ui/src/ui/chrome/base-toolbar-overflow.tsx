/**
 * [INPUT]: Depends on React, i18n, shared Base column contracts, mutation outcomes, UI dropdown/button primitives, lucide icons and the shared view-config hit-area class
 * [OUTPUT]: Provides the container-width toolbar classes (toolbarWideOnlyClass, toolbarNarrowOnlyClass, toolbarLabelClass), GroupByMenuItems and BaseToolbarOverflowMenu
 * [POS]: Shared Base presentation in ui/chrome; the toolbar owns filter/column panel state, this file folds their triggers into one menu below 30rem
 */

import { CheckIcon, Columns3Icon, FunnelIcon, MoreHorizontalIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type { BaseColumn } from "@ai-chat/base-ui/model/bases-ipc";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import { useAppTranslation } from "../platform/i18n";
import { viewConfigHitAreaClass } from "../views/view-config-bar";
import { baseMenuItemHoverClass } from "./base-tab-chrome";

// Literal class strings: Tailwind scans source for them, so they are never templated.
// Below 30rem of toolbar width the filter/columns/group triggers collapse into the overflow menu.
export const toolbarWideOnlyClass = "hidden @[30rem]/base-toolbar:inline-flex";
export const toolbarNarrowOnlyClass = "@[30rem]/base-toolbar:hidden";
export const toolbarLabelClass = "hidden @[30rem]/base-toolbar:inline";
export const toolbarIconOnlyNarrowClass = "@max-[30rem]/base-toolbar:w-7 @max-[30rem]/base-toolbar:px-0";

export function GroupByMenuItems({
  kanban,
  groupColumns,
  groupColumn,
  onGroupByChange,
}: {
  kanban: boolean;
  groupColumns: BaseColumn[];
  groupColumn?: BaseColumn;
  onGroupByChange(columnId: string): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      {!kanban && (
        <DropdownMenuItem
          className={baseMenuItemHoverClass}
          onSelect={() => void onGroupByChange("")}
        >
          <CheckIcon className={cn("size-3.5", groupColumn && "opacity-0")} />
          {t("bases.toolbar.groupNone")}
        </DropdownMenuItem>
      )}
      {groupColumns.map((column) => (
        <DropdownMenuItem
          key={column.id}
          className={baseMenuItemHoverClass}
          onSelect={() => void onGroupByChange(column.id)}
        >
          <CheckIcon
            className={cn(
              "size-3.5",
              column.id !== groupColumn?.id && "opacity-0"
            )}
          />
          {column.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function BaseToolbarOverflowMenu({
  busy,
  className,
  filterOpen,
  filterActive,
  columnsOpen,
  hiddenCount,
  groupable,
  kanban,
  groupColumns,
  groupColumn,
  onToggleFilter,
  onToggleColumns,
  onGroupByChange,
}: {
  busy: boolean;
  className?: string;
  filterOpen: boolean;
  filterActive: boolean;
  columnsOpen: boolean;
  hiddenCount: number;
  groupable: boolean;
  kanban: boolean;
  groupColumns: BaseColumn[];
  groupColumn?: BaseColumn;
  onToggleFilter(): void;
  onToggleColumns(): void;
  onGroupByChange(columnId: string): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("bases.toolbar.more")}
          className={cn(viewConfigHitAreaClass, className)}
          disabled={busy}
          size="icon"
          title={t("bases.toolbar.more")}
          type="button"
          variant={filterOpen || columnsOpen ? "secondary" : "ghost"}
        >
          <MoreHorizontalIcon />
          {(filterActive || hiddenCount > 0) && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem className={baseMenuItemHoverClass} onSelect={onToggleFilter}>
          <FunnelIcon />
          {t("bases.toolbar.filterRows")}
        </DropdownMenuItem>
        <DropdownMenuItem className={baseMenuItemHoverClass} onSelect={onToggleColumns}>
          <Columns3Icon />
          {t("bases.toolbar.manageColumns")}
        </DropdownMenuItem>
        {/* A flat group section instead of a submenu: submenus flip and clip on phones. */}
        {groupable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("bases.toolbar.groupBy")}</DropdownMenuLabel>
            <GroupByMenuItems
              kanban={kanban}
              groupColumns={groupColumns}
              groupColumn={groupColumn}
              onGroupByChange={onGroupByChange}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
