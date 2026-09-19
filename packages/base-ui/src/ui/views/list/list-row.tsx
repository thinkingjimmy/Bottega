/**
 * [INPUT]: Depends on React, i18n, lucide, shadcn Button/DropdownMenu, cn, shared Base column/line/attachment guard, state of BaseMutationOutcome, BaseCellEditor/BaseAttachmentPreview and the same directory attribute projection
 * [OUTPUT]: Provides BaseListRow: a fixed-height read mode (id/status dot/title/attribute chips/date), an edit mode that opens into the field grid, and a hover/focus action menu (aria label from bases.list.rowActions, always visible on touch) that renders nothing when both onPatch and onDelete are absent
 * [POS]: Shared Base presentation in ui/views/list.
 */

import { useEffect, useRef, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
import { HistoryIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellContext,
  BaseColumn,
  BaseRow,
  BaseRowPatch,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  baseCellText,
  cellValue,
  isBaseAttachmentValue,
} from "@ai-chat/base-ui/model/bases-ipc";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import {
  BaseAttachmentPreview,
  BaseCellEditor,
} from "../../editors/cells/base-cell-editor";
import { baseMenuItemHoverClass } from "../../chrome/base-toolbar";
import { viewConfigHitAreaClass } from "../view-config-bar";
import { BaseRowHistoryDialog } from "../../editors/panels/base-row-history";
import {
  LIST_CHIP_CLASS,
  LIST_META_LIMIT,
  ListDateStamp,
  ListPropertyChip,
  ListSelectDot,
  listChipText,
  selectOptionTone,
  type ListColumnProjection,
} from "./list-properties";

const TITLE_SURFACE_CLASS =
  "-mx-2 min-w-0 [&_input]:h-7! [&_input]:w-auto [&_input]:min-w-24 [&_input]:max-w-sm [&_input]:[field-sizing:content] [&_input]:font-medium [&_input]:text-sm";

const FIELD_GRID_CLASS =
  "mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-4 gap-y-1.5";

const FIELD_LABEL_CLASS =
  "w-16 shrink-0 truncate text-[11px] text-muted-foreground";

const ROW_ACTION_REVEAL_CLASS =
  "pointer-events-none opacity-0 transition-opacity group-hover/base-row:pointer-events-auto group-hover/base-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 no-hover:pointer-events-auto no-hover:opacity-100";

export function BaseListRow({
  busy,
  cellContext,
  columns,
  editing,
  owner,
  ownerKey,
  projection,
  relationOptions,
  row,
  onDelete,
  onEditingChange,
  onPatch,
}: {
  busy?: boolean;
  cellContext: BaseCellContext;
  columns: BaseColumn[];
  editing: boolean;
  owner?: { chatId: string; incarnationId: string };
  ownerKey?: string;
  projection: ListColumnProjection;
  relationOptions: BaseRow[];
  row: BaseRow;
  onDelete?(rowId: string): void;
  onEditingChange(editing: boolean): void;

  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { title: titleColumn, status, date, meta } = projection;
  const valueOf = (column: BaseColumn) => cellValue(row, column, cellContext);
  const editRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const root = editRef.current;
    if (!root) return;
    const control = root.querySelector<HTMLElement>(
      "[data-list-title] input, [data-list-title] button"
    );
    (control ?? root).focus({ preventScroll: true });
  }, [editing]);
  const title = titleColumn
    ? baseCellText(titleColumn, valueOf(titleColumn))
    : "";
  const label = title || row.id;

  const actions =
    onPatch || onDelete || ownerKey ? (
      <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("bases.list.rowActions", { title: label })}
            className={cn("size-6 shrink-0 cursor-pointer [--touch-target-inset:-0.5rem]", viewConfigHitAreaClass, ROW_ACTION_REVEAL_CLASS)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ownerKey && (
            <DropdownMenuItem
              className={baseMenuItemHoverClass}
              onSelect={() => setHistoryOpen(true)}
            >
              <HistoryIcon className="size-3.5" />
              {t("bases.history.open")}
            </DropdownMenuItem>
          )}
          {onPatch && (
            <DropdownMenuItem
              className={baseMenuItemHoverClass}
              onSelect={() => onEditingChange(true)}
            >
              <PencilIcon className="size-3.5" />
              {t("bases.list.edit")}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              className={baseMenuItemHoverClass}
              onSelect={() => onDelete(row.id)}
              variant="destructive"
            >
              <Trash2Icon className="size-3.5" />
              {t("bases.list.delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {ownerKey ? (
        <BaseRowHistoryDialog
          columns={columns}
          onOpenChange={setHistoryOpen}
          open={historyOpen}
          ownerKey={ownerKey}
          rowId={row.id}
        />
      ) : null}
      </>
    ) : null;

  if (editing) {
    return (
      <div className="px-3 py-2.5" ref={editRef} tabIndex={-1}>
        <div className="flex items-center gap-2">
          {actions}
          {titleColumn && (
            <div className={TITLE_SURFACE_CLASS} data-list-title>
              <BaseCellEditor
                attachmentOwner={owner}
                column={titleColumn}
                disabled={busy}
                relationContext={cellContext}
                relationOptions={relationOptions}
                storedValue={row.values[titleColumn.id]}
                onCommit={(value) =>
                  onPatch?.(row.id, { [titleColumn.id]: value })
                }
                surface="cell"
                value={valueOf(titleColumn)}
              />
            </div>
          )}
          <Button
            className="ml-auto h-6 shrink-0 cursor-pointer text-xs pointer-coarse:h-8"
            onClick={() => onEditingChange(false)}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("bases.list.done")}
          </Button>
        </div>
        <div className={FIELD_GRID_CLASS}>
          {columns.slice(1).map((column) => (
            <label key={column.id} className="flex min-w-0 items-center gap-2">
              <span className={FIELD_LABEL_CLASS} title={column.name}>
                {column.name}
              </span>
              <span className="min-w-0 flex-1">
                <BaseCellEditor
                  attachmentOwner={owner}
                  column={column}
                  disabled={busy}
                  relationContext={cellContext}
                  relationOptions={relationOptions}
                  storedValue={row.values[column.id]}
                  onCommit={(value) => onPatch?.(row.id, { [column.id]: value })}
                  value={valueOf(column)}
                />
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  const titleValue = titleColumn ? valueOf(titleColumn) : undefined;
  const titleAttachment = isBaseAttachmentValue(titleValue)
    ? titleValue
    : undefined;
  const statusValue = status ? valueOf(status) : undefined;

  const chips = meta.flatMap((column) => {
    const value = valueOf(column);
    const text =
      column.type === "attachment" && isBaseAttachmentValue(value)
        ? value.filename
        : listChipText(column, value);
    return text ? [{ column, text, value }] : [];
  });
  const hidden = chips.slice(LIST_META_LIMIT);
  return (
    <div className="flex h-10 items-center gap-2 px-3">
      {actions}
      <span
        className="hidden w-14 shrink-0 truncate font-mono text-[11px] text-muted-foreground @[26rem]/base-list:inline-block"
        title={row.id}
      >
        {row.id.slice(0, 6)}
      </span>
      {status && (
        <ListSelectDot
          label={`${status.name}: ${baseCellText(status, statusValue) || "—"}`}
          tone={selectOptionTone(status, statusValue)}
        />
      )}

      <button
        className="min-w-0 flex-[3] shrink cursor-pointer truncate text-left font-medium text-[13px]"
        onClick={() => onEditingChange(true)}
        title={title || undefined}
        type="button"
      >
        {titleColumn?.type === "attachment" && titleAttachment ? (
          <BaseAttachmentPreview owner={owner} value={titleAttachment} />
        ) : (
          title || (
            <span className="text-muted-foreground">
              {t("bases.list.untitled")}
            </span>
          )
        )}
      </button>
      <span className="hidden min-w-0 shrink items-center justify-end gap-1.5 @[30rem]/base-list:flex">
        {chips.slice(0, LIST_META_LIMIT).map(({ column, value }) => (
          <ListPropertyChip
            key={column.id}
            column={column}
            owner={owner}
            value={value}
          />
        ))}
        {hidden.length > 0 && (
          <span
            className={cn(LIST_CHIP_CLASS, "shrink-0 tabular-nums")}
            title={hidden
              .map(({ column, text }) => `${column.name}: ${text}`)
              .join("\n")}
          >
            +{hidden.length}
          </span>
        )}
      </span>
      {date && <ListDateStamp column={date} value={valueOf(date)} />}
    </div>
  );
}
