/**
 * [INPUT]: Depends on React, i18n, lucide, shadcn Button/DropdownMenu, cn, shared Base column/line/attachment guard, state of BaseMutationOutcome, BaseCellEditor/BaseAttachmentPreview and the same directory attribute projection
 * [OUTPUT]: Provides BaseListRow: read mode at a row high ((id/status point/title/attributes chip/date), edit mode is open to field grid, and action as a hover/focus displayed array menu ((aria text form bases.list.rowActions); onPatch/onDelete Full absence menu is not rendered)
 * [POS]: Two single-line phases of views/lists; The line does not hold any Base status, and the intent to edit both attribution and deletion is decided by a higher level
 */

import { useEffect, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
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
} from "../../../../../shared/bases-ipc";
import {
  cellValue,
  isBaseAttachmentValue,
} from "../../../../../shared/bases-ipc";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import {
  BaseAttachmentPreview,
  BaseCellEditor,
} from "../../editors/cells/base-cell-editor";
import { baseCellText } from "../../editors/cells/base-cell-text";
import { baseMenuItemHoverClass } from "../../chrome/base-toolbar";
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

/* ── 标题表面 ──────────────────────────────────────────────────
 * 编辑态首列复用 cell 表面（无内框、透明底），外层后代变体只负责放大字号与字重，
 * 让它读起来是标题、点下去仍是同一个编辑器——不必为此在 editor 里开第三种 surface。
 *
 * 宽度不能继承 cell 的 w-full：透明底的标题一旦撑满整行，date 的日历图标就被甩到
 * 行尾，读起来像一枚与文字无关的孤立图标。field-sizing:content 把「宽度随内容」
 * 交还给平台，于是 date/number/text 七类标题各自收到自己该有的宽度——特殊情况
 * 消失在原语里，而不是在这里长出按类型分支。min/max 只兜住两端。
 * ────────────────────────────────────────────────────────── */
const TITLE_SURFACE_CLASS =
  "-mx-2 min-w-0 [&_input]:h-7! [&_input]:w-auto [&_input]:min-w-24 [&_input]:max-w-sm [&_input]:[field-sizing:content] [&_input]:font-medium [&_input]:text-sm";

/* ── 字段轨道 ──────────────────────────────────────────────────
 * auto-fill 定轨取代 flex-wrap：轨宽由容器决定而非内容，
 * 于是「金额 26.6」和「消费项目 招牌三拼…」落在同一列宽上，
 * 行高只随轨道行数阶跃变化，不再随每行文本长度乱跳。
 * min() 兜住窄容器——否则 15rem 下限会顶出横向溢出。
 * ────────────────────────────────────────────────────────── */
const FIELD_GRID_CLASS =
  "mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-x-4 gap-y-1.5";

const FIELD_LABEL_CLASS =
  "w-16 shrink-0 truncate text-[11px] text-muted-foreground";

/* ── 行动作 ────────────────────────────────────────────────────
 * hover 与 focus-visible 同为显现通道，与 toolbar/表头操作按钮同构：
 * 只有鼠标能到达的功能等于键盘用户不存在。菜单展开期间用 data-state 钉住，
 * 否则指针一移进菜单，触发器就随 hover 消失而抽走自己脚下的定位锚点。
 *
 * 命中区必须与可见性同生共死：透明按钮照样吃点击，行首那块「看起来是空白」
 * 的地方会把「点开这一行」变成「弹出一个菜单」。hover 是点击的前提，
 * 故 group-hover 恢复命中区不会让鼠标够不着。
 * ────────────────────────────────────────────────────────── */
const ROW_ACTION_REVEAL_CLASS =
  "pointer-events-none opacity-0 transition-opacity group-hover/base-row:pointer-events-auto group-hover/base-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100";

export function BaseListRow({
  busy,
  cellContext,
  columns,
  editing,
  owner,
  ownerKey,
  projection,
  relationRows,
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
  relationRows: BaseRow[];
  row: BaseRow;
  onDelete?(rowId: string): void;
  onEditingChange(editing: boolean): void;
  /** 缺席即只读：Edit 菜单项与编辑态都不长出来；intent 永不 reject */
  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { title: titleColumn, status, date, meta } = projection;
  const valueOf = (column: BaseColumn) => cellValue(row, column, cellContext);
  const editRef = useRef<HTMLDivElement>(null);
  /* ── 入编辑必须接住焦点 ────────────────────────────────────────
   * 标题按钮点下去的瞬间它自己就被编辑器取代了，焦点无处可去只能回落 body。
   * 焦点一旦离开这一行，Esc 的 keydown 就不再经过行——退出路径在真机上静默失效
   * （单测里手动往 article 派发事件恰好绕过了这件事）。
   * 于是入编辑即把焦点交给标题控件：既接住了 Esc，也让「点标题」等于「开始改标题」。
   * ────────────────────────────────────────────────────────── */
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
  /* 只读行没有任何可选动作：菜单整个不长出来，而不是端出一份空菜单。 */
  const actions =
    onPatch || onDelete || ownerKey ? (
      <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("bases.list.rowActions", { title: label })}
            className={cn("size-6 shrink-0 cursor-pointer", ROW_ACTION_REVEAL_CLASS)}
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
                relationColumns={columns}
                relationRows={relationRows}
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
            className="ml-auto h-6 shrink-0 cursor-pointer text-xs"
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
                  relationColumns={columns}
                  relationRows={relationRows}
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
  // 空值不占位：定高行里的空 chip 只是噪音，超出上限的收进一枚计数
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
      {/* 整条空白都是入口：按钮撑满标题到 chip 之间的余量，
          行看起来仍是一行文字，键盘却拿到了与鼠标同一个落点。 */}
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
