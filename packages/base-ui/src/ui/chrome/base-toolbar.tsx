/**
 * [INPUT]: Depends on React, shared Base meta/filter contracts, i18n, mutation outcomes, UI menus/forms/icons, the overflow menu module and the shared hit-area class
 * [OUTPUT]: Provides BaseToolbar (a container-query toolbar that folds filter/columns/group into an overflow menu below 30rem), the bounded column panel, localized column actions, formula-aware column chips and the re-exported BaseFilterEditor
 * [POS]: Shared Base presentation in ui/chrome.
 */

import { useMemo, useState } from "react";
import { useAppTranslation } from "../platform/i18n";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import {
  CalendarIcon,
  CheckIcon,
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  FunnelIcon,
  GitForkIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  ListTreeIcon,
  MapPinIcon,
  PlusIcon,
  SquareCheckIcon,
  SigmaIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseColumn,
  BaseColumnType,
  BaseFilter,
  BaseMeta,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  BASE_COLUMN_LIMIT,
  formulaExpressionForDisplay,
  isColumnScopedView,
  isGroupableView,
} from "@ai-chat/base-ui/model/bases-ipc";
import { BaseFormulaEditor } from "../editors/panels/base-formula-editor";
import { BaseFilterEditor } from "./base-filter-editor";
import { baseMenuItemHoverClass } from "./base-tab-chrome";
import { BaseToolbarOverflowMenu, GroupByMenuItems, toolbarIconOnlyNarrowClass, toolbarLabelClass, toolbarNarrowOnlyClass, toolbarWideOnlyClass } from "./base-toolbar-overflow";
import { InlineNameInput } from "./inline-name-input";
import { viewConfigHitAreaClass } from "../views/view-config-bar";
export { baseMenuItemHoverClass } from "./base-tab-chrome";

// ============================================================================

// ============================================================================

const COLUMN_TYPES: Array<{
  type: BaseColumnType;
  Icon: typeof TypeIcon;
}> = [
  { type: "text", Icon: TypeIcon },
  { type: "number", Icon: HashIcon },
  { type: "date", Icon: CalendarIcon },
  { type: "select", Icon: CheckIcon },
  { type: "checkbox", Icon: SquareCheckIcon },
  { type: "url", Icon: LinkIcon },
  { type: "location", Icon: MapPinIcon },
  { type: "attachment", Icon: ImageIcon },
  { type: "formula", Icon: SigmaIcon },
  { type: "relation", Icon: GitForkIcon },
];

const chipActionRevealClass =
  "cursor-pointer text-muted-foreground opacity-0 transition-opacity group-hover/column-chip:opacity-100 group-has-[:focus-visible]/column-chip:opacity-100 no-hover:opacity-100 pointer-coarse:grid pointer-coarse:size-8 pointer-coarse:place-items-center";

// The inset borrows 8px of hit area from each neighbour: enough for a thumb, not enough to steal a header click.
export const baseActionButtonClass =
  "relative touch-target-44 [--touch-target-inset:-0.5rem] cursor-pointer rounded-sm p-1 text-muted-foreground! transition-colors hover:bg-transparent hover:text-foreground! focus:text-foreground!";

export const baseDestructiveActionButtonClass = cn(
  baseActionButtonClass,
  "hover:text-destructive! focus:text-destructive!"
);

export function BaseToolbar({
  meta,
  activeViewId,
  filter,
  busy,
  viewTabs,
  onFilter,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onGroupByChange,
  onVisibleColumnsChange,
  onAddRow,
  primaryAction,
  secondaryAction,
  allowStructure = true,
  allowViewConfiguration = allowStructure,
  allowRowMutation = true,
}: {
  meta: BaseMeta;
  activeViewId: string;
  filter?: BaseFilter;
  busy: boolean;
  viewTabs: React.ReactNode;

  onFilter(filter?: BaseFilter): Promise<BaseMutationOutcome>;
  onAddColumn(
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
  onRenameColumn(id: string, name: string): Promise<BaseMutationOutcome>;
  onDeleteColumn(id: string): Promise<BaseMutationOutcome>;
  onGroupByChange(columnId: string): Promise<BaseMutationOutcome>;

  onVisibleColumnsChange(columnIds: string[]): Promise<BaseMutationOutcome>;
  onAddRow(): Promise<BaseMutationOutcome>;

  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  allowStructure?: boolean;
  allowViewConfiguration?: boolean;
  allowRowMutation?: boolean;
}) {
  const { t } = useAppTranslation();
  const [columnsOpen, setColumnsOpen] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [renameColumnId, setRenameColumnId] = useState("");
  const [deleteColumnId, setDeleteColumnId] = useState("");
  const activeView = meta.views.find((view) => view.id === activeViewId);
  const deleteColumn = meta.columns.find(
    (column) => column.id === deleteColumnId
  );

  const kanban = activeView?.config.type === "kanban";
  const groupable = Boolean(activeView && isGroupableView(activeView.config));
  const groupColumns = meta.columns.filter(
    (column) => column.type === "select"
  );
  const configuredGroupId =
    activeView && isGroupableView(activeView.config)
      ? activeView.config.groupByColumnId
      : undefined;
  const groupColumn =
    groupColumns.find((column) => column.id === configuredGroupId) ??
    (kanban ? groupColumns[0] : undefined);

  const scopedConfig =
    activeView && isColumnScopedView(activeView.config)
      ? activeView.config
      : undefined;
  const visibleColumnIds = scopedConfig?.visibleColumnIds;

  const hiddenColumnIds = useMemo(() => {
    if (!visibleColumnIds?.length) return new Set<string>();
    const visible = new Set(visibleColumnIds);
    return new Set(
      meta.columns
        .map((column) => column.id)
        .filter((id) => !visible.has(id))
    );
  }, [meta.columns, visibleColumnIds]);
  const toggleColumnVisible = (columnId: string) => {
    const hidden = new Set(hiddenColumnIds);
    if (!hidden.delete(columnId)) hidden.add(columnId);
    return onVisibleColumnsChange(
      meta.columns
        .filter((column) => !hidden.has(column.id))
        .map((column) => column.id)
    );
  };
  return (
    <div className="@container/base-toolbar shrink-0 border-b bg-background">

      <div className="flex h-10 items-center gap-1 px-2">
        {viewTabs}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {secondaryAction}
          {allowViewConfiguration && <Button
            aria-label={t("bases.toolbar.toggleFilter")}
            className={cn("relative", viewConfigHitAreaClass, toolbarWideOnlyClass)}
            onClick={() => setFilterOpen((value) => !value)}
            size="icon"
            title={t("bases.toolbar.filterRows")}
            type="button"
            variant={filterOpen ? "secondary" : "ghost"}
          >
            <FunnelIcon />
            {filter && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Button>}
          {allowViewConfiguration && <Button
            aria-label={t("bases.toolbar.manageColumns")}
            className={cn("relative", viewConfigHitAreaClass, toolbarWideOnlyClass)}
            onClick={() => setColumnsOpen((value) => !value)}
            size="icon"
            title={t("bases.toolbar.manageColumns")}
            type="button"
            variant={columnsOpen ? "secondary" : "ghost"}
          >
            <Columns3Icon />

            {hiddenColumnIds.size > 0 && (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            )}
          </Button>}
          {allowViewConfiguration && groupable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t("bases.toolbar.groupByCurrent", {
                    column: groupColumn?.name ?? t("bases.toolbar.groupNone"),
                  })}
                  className={cn(viewConfigHitAreaClass, toolbarWideOnlyClass)}
                  disabled={busy || (kanban && groupColumns.length === 0)}
                  size="icon"
                  title={t("bases.toolbar.groupBy")}
                  type="button"
                  variant={groupColumn ? "secondary" : "ghost"}
                >
                  <ListTreeIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuLabel>{t("bases.toolbar.groupBy")}</DropdownMenuLabel>
                <GroupByMenuItems
                  kanban={kanban}
                  groupColumns={groupColumns}
                  groupColumn={groupColumn}
                  onGroupByChange={onGroupByChange}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {allowViewConfiguration && (
            <BaseToolbarOverflowMenu
              busy={busy}
              className={toolbarNarrowOnlyClass}
              columnsOpen={columnsOpen}
              filterActive={Boolean(filter)}
              filterOpen={filterOpen}
              groupColumn={groupColumn}
              groupColumns={groupColumns}
              groupable={groupable && !(kanban && groupColumns.length === 0)}
              hiddenCount={hiddenColumnIds.size}
              kanban={kanban}
              onGroupByChange={onGroupByChange}
              onToggleColumns={() => setColumnsOpen((value) => !value)}
              onToggleFilter={() => setFilterOpen((value) => !value)}
            />
          )}
          {allowViewConfiguration && primaryAction ? primaryAction :
            (allowRowMutation && (
            <Button
              aria-label={t("bases.toolbar.addRow")}
              className={cn("h-7 text-xs", toolbarIconOnlyNarrowClass)}
              disabled={busy}
              onClick={() => void onAddRow()}
              size="sm"
              type="button"
              variant="default"
            >
              <PlusIcon />
              <span className={toolbarLabelClass}>{t("bases.toolbar.addRow")}</span>
            </Button>
          ))}
        </div>
      </div>
      {allowViewConfiguration && filterOpen && (
        <div className="border-t px-2 py-1.5">
          <BaseFilterEditor
            key={`${activeViewId}:${meta.columns.map((column) => column.id).join(",")}:${JSON.stringify(filter)}`}
            busy={busy}
            columns={meta.columns}
            filter={filter}
            onFilter={onFilter}
          />
        </div>
      )}
      {allowViewConfiguration && columnsOpen && (
        <SlimScroller className="flex max-h-48 flex-wrap items-center gap-1.5 overflow-y-auto border-t px-2 py-1.5">
          {meta.columns.map((column) => {
            const Icon =
              COLUMN_TYPES.find((item) => item.type === column.type)?.Icon ??
              TypeIcon;
            if (allowStructure && column.id === renameColumnId) {
              return (
                <InlineNameInput
                  key={column.id}
                  ariaLabel={t("bases.table.renameColumnAria", {
                    column: column.name,
                  })}
                  autoFocus
                  className="h-7 w-28 text-xs pointer-coarse:h-9 pointer-coarse:w-40"
                  name={column.name}
                  onDone={() => setRenameColumnId("")}
                  onRename={(name) => onRenameColumn(column.id, name)}
                />
              );
            }
            const hidden = hiddenColumnIds.has(column.id);

            const expression =
              column.type === "formula" && column.formula
                ? formulaExpressionForDisplay(
                    column.formula.expression,
                    meta.columns
                  )
                : "";
            return (
              <span
                key={column.id}
                className={cn(
                  "group/column-chip inline-flex h-7 items-center gap-1.5 rounded-md border bg-muted/40 px-2 text-xs pointer-coarse:h-9",
                  hidden && "border-dashed bg-transparent text-muted-foreground"
                )}
                data-column-hidden={hidden || undefined}
              >

                <Icon className="size-3 text-muted-foreground" />
                {allowStructure ? <button
                  aria-label={t("bases.table.renameColumnAria", {
                    column: column.name,
                  })}
                  className={cn(
                    "cursor-pointer hover:underline",
                    hidden && "line-through decoration-muted-foreground/50"
                  )}
                  disabled={busy}
                  onClick={() => setRenameColumnId(column.id)}
                  title={t("bases.toolbar.renameColumn")}
                  type="button"
                >
                  {column.name}
                </button> : <span>{column.name}</span>}
                {expression && (
                  <code
                    className="max-w-40 truncate font-mono text-[10px] text-muted-foreground"
                    data-formula-expression={column.id}
                    title={expression}
                  >
                    {expression}
                  </code>
                )}

                {scopedConfig && (
                  <button
                    aria-label={t(
                      hidden
                        ? "bases.toolbar.showColumn"
                        : "bases.toolbar.hideColumn",
                      { column: column.name }
                    )}
                    aria-pressed={!hidden}
                    className={cn(
                      chipActionRevealClass,
                      "hover:text-foreground",
                      hidden && "opacity-100"
                    )}
                    disabled={busy}
                    onClick={() => void toggleColumnVisible(column.id)}
                    title={t(
                      hidden
                        ? "bases.toolbar.showField"
                        : "bases.toolbar.hideField"
                    )}
                    type="button"
                  >
                    {hidden ? (
                      <EyeOffIcon className="size-3" />
                    ) : (
                      <EyeIcon className="size-3" />
                    )}
                  </button>
                )}
                {allowStructure && <button
                  aria-label={t("bases.toolbar.deleteColumn", { column: column.name })}
                  className={cn(chipActionRevealClass, "hover:text-destructive")}
                  disabled={busy}
                  onClick={() => setDeleteColumnId(column.id)}
                  type="button"
                >
                  <Trash2Icon className="size-3" />
                </button>}
              </span>
            );
          })}
          {allowStructure && <AddColumnMenu
            columns={meta.columns}
            onAddColumn={onAddColumn}
            trigger={
              <Button
                className="h-7 border-0 text-xs"
                disabled={busy || meta.columns.length >= BASE_COLUMN_LIMIT}
                size="sm"
                type="button"
                variant="ghost"
              >
                <PlusIcon />
                {t("bases.toolbar.addColumn")}
              </Button>
            }
          />}
        </SlimScroller>
      )}
      {allowStructure && <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.table.deleteColumnConfirm")}
        confirmTone="destructive"
        description={t("bases.table.deleteColumnDescription", {
          column: deleteColumn?.name ?? "",
        })}
        onConfirm={() =>
          void onDeleteColumn(deleteColumnId).then((error) => {

            if (!error) setDeleteColumnId("");
          })
        }
        onOpenChange={(open) => {
          if (!open) setDeleteColumnId("");
        }}
        open={Boolean(deleteColumn)}
        title={t("bases.table.deleteColumnTitle")}
      />}
    </div>
  );
}

export function AddColumnMenu({
  columns,
  onAddColumn,
  trigger,
}: {
  columns: BaseColumn[];
  onAddColumn(
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
  trigger: React.ReactNode;
}) {
  const { t } = useAppTranslation();
  const [formulaOpen, setFormulaOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("bases.toolbar.columnTypeLabel")}</DropdownMenuLabel>
          {COLUMN_TYPES.map(({ type, Icon }) => (
            <DropdownMenuItem
              key={type}
              className={baseMenuItemHoverClass}
              onSelect={() =>
                type === "formula"
                  ? setFormulaOpen(true)
                  : void onAddColumn(type)
              }
            >
              <Icon className="size-3.5" />
              {t(`bases.columnType.${type}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {formulaOpen && (
        <BaseFormulaEditor
          columns={columns}
          onOpenChange={setFormulaOpen}
          onSubmit={(formula) => onAddColumn("formula", formula)}
          open
        />
      )}
    </>
  );
}

export { BaseFilterEditor } from "./base-filter-editor";
