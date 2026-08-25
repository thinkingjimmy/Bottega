/**
 * [INPUT]: Depends on React, shared Base value/attachment, strict date/select first-id-wins, bases-client, abbreviation diagram, relation selector for../panels, state of BaseMutationOutcome judgment type and shadcn template language
 * [OUTPUT]: Provides BaseCellEditor, read-only BaseAttachmentPreview and useBaseAttachmentThumbnail ((maxEdge adjustable, the cover of the sign reads the same path); attachment with a focus shortening and a regularly deleted key presentation of ≥44px, relationship only read directly spit canonical base CellText ((the hanging statement is not an alternative sentence here), the rest of the type shares already edited truth
 * [POS]: The only type of editor for bases/editors/cells; table replicate the cell surface without the internal frame, list replicate the independent field surface
 */

import { useEffect, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import {
  CalendarIcon,
  ExternalLinkIcon,
  ImageIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Calendar } from "@ai-chat/ui/components/ui/calendar";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellValue,
  BaseColumn,
  BaseLocation,
  BaseAttachmentValue,
  BaseRow,
} from "../../../../../shared/bases-ipc";
import {
  baseCellText,
  dedupeSelectOptions,
  formatBaseDate,
  isBaseAttachmentValue,
  parseBaseDate,
} from "../../../../../shared/bases-ipc";
import { openExternal } from "@/lib/agent-client";
import { readBaseAttachmentThumbnail } from "@/lib/bases/client";
import { BaseRelationPicker } from "../panels/base-relation-picker";

export function BaseCellEditor({
  column,
  value,
  disabled,
  surface = "field",
  attachmentOwner,
  relationColumns,
  relationRows,
  storedValue,
  onCommit,
}: {
  column: BaseColumn;
  value: BaseCellValue | undefined;
  disabled?: boolean;
  surface?: "field" | "cell";
  attachmentOwner?: { chatId: string; incarnationId: string };
  relationColumns?: BaseColumn[];
  relationRows?: BaseRow[];
  storedValue?: BaseCellValue;
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void;
}) {
  if (column.type === "relation") {
    if (relationColumns && relationRows) {
      return (
        <BaseRelationPicker
          column={column as BaseColumn & { type: "relation" }}
          columns={relationColumns}
          disabled={disabled}
          onCommit={onCommit}
          rows={relationRows}
          value={typeof storedValue === "string" ? storedValue : undefined}
        />
      );
    }
    /* 悬垂引用不在这里另起一句：canonical 投影已经把「已删除的记录 (xxxxxxxx)」
       说清楚了，屏幕上与导出的 CSV 必须是同一行字。 */
    return (
      <span className="block min-h-7 w-full truncate px-1.5 py-1 text-xs">
        {baseCellText(column, value) || "—"}
      </span>
    );
  }
  if (column.type === "formula") {
    const text = baseCellText(column, value);
    return (
      <span
        aria-label={column.name}
        className={cn(
          "block min-h-7 w-full truncate px-1.5 py-1 text-xs",
          text.startsWith("#") && "text-destructive"
        )}
        data-formula-readonly="true"
        title={text}
      >
        {text || "—"}
      </span>
    );
  }
  if (column.type === "attachment") {
    return (
      <AttachmentCellEditor
        disabled={disabled}
        onCommit={onCommit}
        owner={attachmentOwner}
        value={isBaseAttachmentValue(value) ? value : undefined}
      />
    );
  }
  if (column.type === "checkbox") {
    const checkbox = (
      <input
        aria-label={column.name}
        checked={value === true}
        className="size-4 cursor-pointer accent-foreground"
        disabled={disabled}
        onChange={(event) => void onCommit(event.target.checked)}
        type="checkbox"
      />
    );
    return surface === "cell" ? (
      <span className="flex h-9 w-full items-center px-2">{checkbox}</span>
    ) : (
      checkbox
    );
  }
  if (column.type === "select") {
    return (
      <Select
        disabled={disabled}
        onValueChange={(next) =>
          void onCommit(next === EMPTY_SELECT_VALUE ? null : next)
        }
        value={typeof value === "string" ? value : EMPTY_SELECT_VALUE}
      >
        <SelectTrigger
          aria-label={column.name}
          className={cn(
            surface === "cell"
              ? cn(CELL_CONTROL_CLASS, "justify-between pr-3")
              : "h-7 w-full min-w-24 bg-background px-1.5 text-xs"
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY_SELECT_VALUE}>—</SelectItem>
          {dedupeSelectOptions(column.options).map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (column.type === "date") {
    return (
      <DateCellEditor
        column={column}
        disabled={disabled}
        onCommit={onCommit}
        surface={surface}
        value={value}
      />
    );
  }
  if (column.type === "location") {
    const location =
      value && typeof value === "object" && !("kind" in value)
        ? value
        : ({ lat: 0, lng: 0 } as BaseLocation);
    return (
      <div
        className={cn(
          "grid w-full grid-cols-2",
          surface === "field" && "gap-1"
        )}
      >
        {(["lat", "lng"] as const).map((key) => (
          <Input
            key={key}
            aria-label={`${column.name} ${key}`}
            className={
              surface === "cell"
                ? CELL_CONTROL_CLASS
                : "h-7 px-1.5 text-xs"
            }
            disabled={disabled}
            max={key === "lat" ? 90 : 180}
            min={key === "lat" ? -90 : -180}
            onBlur={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                void onCommit({ ...location, [key]: next });
              }
            }}
            step="any"
            type="number"
            defaultValue={location[key]}
          />
        ))}
      </div>
    );
  }

  return (
    <ScalarCellEditor
      key={display(value)}
      column={column}
      disabled={disabled}
      onCommit={onCommit}
      surface={surface}
      value={value}
    />
  );
}

function AttachmentCellEditor({
  disabled,
  owner,
  value,
  onCommit,
}: {
  disabled?: boolean;
  owner?: { chatId: string; incarnationId: string };
  value?: Extract<BaseCellValue, { kind: "attachment" }>;
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void;
}) {
  const { t } = useAppTranslation();
  const rootRef = useRef<HTMLSpanElement>(null);
  return (
    <span
      className="group/attachment flex min-h-11 w-full items-center gap-2 px-1.5"
      ref={rootRef}
      tabIndex={-1}
    >
      {value ? (
        <>
          <BaseAttachmentPreview owner={owner} value={value} />
          <Button
            aria-label={`Delete ${value.filename}`}
            className="size-11 shrink-0 text-destructive opacity-100 transition-opacity motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/attachment:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100"
            disabled={disabled}
            onClick={async () => {
              await onCommit(null);
              rootRef.current?.focus();
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2Icon aria-hidden />
          </Button>
        </>
      ) : (
        <span className="flex items-center gap-2 px-0.5 text-muted-foreground text-xs">
          <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
          {t("bases.cell.empty")}
        </span>
      )}
    </span>
  );
}

export function BaseAttachmentPreview({
  owner,
  value,
}: {
  owner?: { chatId: string; incarnationId: string };
  value: BaseAttachmentValue;
}) {
  const thumbnail = useBaseAttachmentThumbnail(owner, value);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {thumbnail ? (
        <img
          alt={value.filename}
          className="size-9 shrink-0 rounded object-cover"
          src={thumbnail}
        />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded bg-muted">
          <ImageIcon aria-hidden className="size-4 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs" title={value.filename}>
        {value.filename}
      </span>
    </span>
  );
}

/**
 * 行内缩略图的唯一读取路径：owner 与 revision 一变即换 key，
 * 旧值在新 key 落地前一律读作空，避免上一张图在新单元格里逗留。
 * maxEdge 计入 key——不同消费方（行内 36px 缩略图 / 看板封面）要的是不同尺寸，
 * 共用一份缓存反而会把封面拉成马赛克。
 */
export function useBaseAttachmentThumbnail(
  owner: { chatId: string; incarnationId: string } | undefined,
  value: BaseAttachmentValue,
  maxEdge = 160
) {
  const chatId = owner?.chatId;
  const incarnationId = owner?.incarnationId;
  const key = `${chatId ?? ""}/${incarnationId ?? ""}/${value.attachmentId}/${value.revision}/${maxEdge}`;
  const [thumbnail, setThumbnail] = useState({ key: "", dataUrl: "" });
  useEffect(() => {
    let active = true;
    if (!chatId || !incarnationId) return () => undefined;
    void readBaseAttachmentThumbnail({
      chatId,
      incarnationId,
      attachmentId: value.attachmentId,
      revision: value.revision,
      maxEdge,
      requestVersion: 0,
    }).then((result) => {
      if (active && result.ok) {
        setThumbnail({ key, dataUrl: result.value.dataUrl });
      }
    });
    return () => {
      active = false;
    };
  }, [chatId, incarnationId, key, maxEdge, value.attachmentId, value.revision]);
  return thumbnail.key === key ? thumbnail.dataUrl : "";
}

function DateCellEditor({
  column,
  value,
  disabled,
  surface,
  onCommit,
}: {
  column: BaseColumn;
  value: BaseCellValue | undefined;
  disabled?: boolean;
  surface: "field" | "cell";
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const selected = parseBaseDate(value);
  const choose = (date: Date) => {
    void onCommit(formatBaseDate(date));
    setOpen(false);
  };
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={column.name}
          className={cn(
            "font-normal",
            surface === "cell"
              ? cn(CELL_CONTROL_CLASS, "justify-start gap-1.5")
              : "h-7 min-w-28 justify-start gap-1.5 px-1.5"
          )}
          disabled={disabled}
          type="button"
          variant={surface === "cell" ? "ghost" : "outline"}
        >
          <CalendarIcon className="text-muted-foreground" />
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected
              ? formatBaseDate(selected)
              : typeof value === "string"
                ? value
                : "—"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          autoFocus
          defaultMonth={selected}
          mode="single"
          onSelect={(date) => {
            if (date) choose(date);
          }}
          selected={selected}
        />
        <div className="flex items-center justify-between border-t p-2">
          <Button
            disabled={!selected}
            onClick={() => {
              void onCommit(null);
              setOpen(false);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("bases.cell.clear")}
          </Button>
          <Button
            onClick={() => choose(new Date())}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("bases.cell.today")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScalarCellEditor({
  column,
  value,
  disabled,
  surface,
  onCommit,
}: {
  column: BaseColumn;
  value: BaseCellValue | undefined;
  disabled?: boolean;
  surface: "field" | "cell";
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void;
}) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState(display(value));
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return void onCommit(null);
    if (column.type === "number") {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) void onCommit(parsed);
      return;
    }
    void onCommit(trimmed);
  };
  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        surface === "cell" ? "h-9 w-full" : "gap-1"
      )}
    >
      <Input
        aria-label={column.name}
        className={cn(
          "min-w-0 text-xs",
          surface === "cell" ? CELL_CONTROL_CLASS : "h-7 px-1.5"
        )}
        disabled={disabled}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        type={
          column.type === "number"
            ? "number"
            : column.type === "url"
              ? "url"
              : "text"
        }
        value={draft}
      />
      {column.type === "url" && typeof value === "string" && (
        <Button
          aria-label={t("bases.cell.openLink")}
          className="size-7 shrink-0"
          onClick={() => void openExternal(value)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ExternalLinkIcon />
        </Button>
      )}
    </div>
  );
}

const CELL_CONTROL_CLASS =
  "h-9 w-full rounded-none border-0 bg-transparent px-2 shadow-none outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30";

const EMPTY_SELECT_VALUE = "__base-empty!__";

function display(value: BaseCellValue | undefined) {
  if (value === undefined) return "";
  if (typeof value === "object") {
    return isBaseAttachmentValue(value)
      ? value.filename
      : `${value.lat}, ${value.lng}`;
  }
  return String(value);
}
