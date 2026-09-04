/**
 * [INPUT]: Depends on React, shared BaseView contracts, menus/dialogs, tab chrome, InlineNameInput, icons, and Base mutation outcomes
 * [OUTPUT]: Provides BaseViewTabs; Single VIEW_TYPES directory drives six standard view tabs with added menus
 * [POS]: The view bar for bases/chrome is switched to the viewTabs slot in the BaseToolbar; Only the semantic intent, optimistic switch to the BaseWorkbench with CAS
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import {
  KanbanIcon,
  ChartPieIcon,
  ImagesIcon,
  ListIcon,
  MapIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Table2Icon,
  Trash2Icon,
} from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type { BaseView, BaseViewConfig } from "../../../../shared/bases-ipc";
import { BASE_VIEW_LIMIT } from "../../../../shared/bases-ipc";
import {
  baseTabActionButtonClass,
  baseTabShellClass,
} from "./base-tab-chrome";
import { baseMenuItemHoverClass } from "./base-toolbar";
import { InlineNameInput } from "./inline-name-input";

// ============================================================================
// 视图类型的唯一目录：tab 图标与「+」菜单同源
// ============================================================================

/* 视图类型的身份是 type，名字归目录（bases.viewType.*）。 */
const VIEW_TYPES: Array<{
  type: BaseViewConfig["type"];
  Icon: typeof Table2Icon;
}> = [
  { type: "table", Icon: Table2Icon },
  { type: "list", Icon: ListIcon },
  { type: "kanban", Icon: KanbanIcon },
  { type: "map", Icon: MapIcon },
  { type: "chart", Icon: ChartPieIcon },
  { type: "gallery", Icon: ImagesIcon },
];

export function BaseViewTabs({
  views,
  activeViewId,
  busy,
  onSelect,
  onAddView,
  onRenameView,
  onDeleteView,
  editable = true,
}: {
  views: BaseView[];
  activeViewId: string;
  busy: boolean;
  onSelect(id: string): void;
  /* intent 一律来自 workbench 的收口出口：判决即返回值，永不 reject。 */
  onAddView(type: BaseViewConfig["type"]): Promise<BaseMutationOutcome>;
  onRenameView(id: string, name: string): Promise<BaseMutationOutcome>;
  onDeleteView(id: string): Promise<BaseMutationOutcome>;
  editable?: boolean;
}) {
  const { t } = useAppTranslation();
  const [renameViewId, setRenameViewId] = useState("");
  const [deleteViewId, setDeleteViewId] = useState("");
  const deleteView = views.find((view) => view.id === deleteViewId);
  /* order 是持久化的显示序，不是渲染时才决定的事：每次重渲染重排一遍
     （还得先复制一份数组以免就地改 props）纯属白做工。 */
  const orderedViews = useMemo(
    () => [...views].sort((left, right) => left.order - right.order),
    [views]
  );
  const tablistRef = useRef<HTMLDivElement>(null);
  // active tab 溢出视口时自动滚入视野（新增视图默认排尾，最易被裁掉）
  useEffect(() => {
    tablistRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeViewId]);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <SlimScroller
        ref={tablistRef}
        aria-label={t("bases.view.tabsAria")}
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        role="tablist"
      >
        {orderedViews.map((view) =>
          view.id === renameViewId ? (
            <InlineNameInput
              key={view.id}
              ariaLabel={t("bases.view.rename")}
              autoFocus
              className="h-6 w-32 shrink-0 text-xs"
              name={view.name}
              onDone={() => setRenameViewId("")}
              onRename={(name) => onRenameView(view.id, name)}
            />
          ) : (
            <ViewTab
              key={view.id}
              active={view.id === activeViewId}
              busy={busy}
              canDelete={editable && views.length > 1}
              editable={editable}
              onDelete={() => setDeleteViewId(view.id)}
              onRename={() => setRenameViewId(view.id)}
              onSelect={() => onSelect(view.id)}
              view={view}
            />
          )
        )}
      </SlimScroller>
      {editable && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("bases.view.add")}
            className="size-6 shrink-0"
            disabled={busy || views.length >= BASE_VIEW_LIMIT}
            size="icon"
            title={t("bases.view.add")}
            type="button"
            variant="ghost"
          >
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("bases.view.new")}</DropdownMenuLabel>
          {VIEW_TYPES.map(({ type, Icon }) => (
            <DropdownMenuItem
              key={type}
              className={baseMenuItemHoverClass}
              onSelect={() => void onAddView(type)}
            >
              <Icon className="size-3.5" />
              {t(`bases.viewType.${type}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>}
      {editable && <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.view.deleteConfirm")}
        confirmTone="destructive"
        description={t("bases.view.deleteDescription", {
          view: deleteView?.name ?? "",
        })}
        onConfirm={() =>
          void onDeleteView(deleteViewId).then((error) => {
            // 失败留在原地：错因在顶部横幅，弹窗关掉反而抹掉现场
            if (!error) setDeleteViewId("");
          })
        }
        onOpenChange={(open) => {
          if (!open) setDeleteViewId("");
        }}
        open={Boolean(deleteView)}
        title={t("bases.view.deleteTitle")}
      />}
    </div>
  );
}

function ViewTab({
  view,
  active,
  busy,
  canDelete,
  onSelect,
  onRename,
  onDelete,
  editable,
}: {
  view: BaseView;
  active: boolean;
  busy: boolean;
  canDelete: boolean;
  editable: boolean;
  onSelect(): void;
  onRename(): void;
  onDelete(): void;
}) {
  const { t } = useAppTranslation();
  const Icon =
    VIEW_TYPES.find((item) => item.type === view.config.type)?.Icon ??
    Table2Icon;
  return (
    <div
      aria-selected={active}
      // 比宿主 PanelTabs 低一号（h-6）以显层级——这是两条 tab 条真正的差异
      className={cn(baseTabShellClass(active), "h-6 shrink-0 gap-1")}
      onClick={onSelect}
      onDoubleClick={editable ? onRename : undefined}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="tab"
      tabIndex={0}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{view.name}</span>
      {editable && <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={t("bases.view.moreActions", { view: view.name })}
            className={baseTabActionButtonClass}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            title={t("bases.view.more")}
            type="button"
          >
            <MoreHorizontalIcon className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            className={baseMenuItemHoverClass}
            onSelect={onRename}
          >
            <PencilIcon className="size-3.5" />
            {t("bases.view.renameItem")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={baseMenuItemHoverClass}
            disabled={busy || !canDelete}
            onSelect={onDelete}
            variant="destructive"
          >
            <Trash2Icon className="size-3.5" />
            {t("bases.view.deleteItem")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>}
    </div>
  );
}
