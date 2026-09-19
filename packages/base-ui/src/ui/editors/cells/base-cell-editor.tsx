/**
 * [INPUT]: Depends on Base value/attachment contracts, thumbnail loading, mutation outcomes, and relation context plus canonical row options
 * [OUTPUT]: Provides typed draft-preserving cell editors (full-cell checkbox hit area, taller field triggers on touch), scoped attachment previews with source-device availability and relation editing.
 * [POS]: Shared Base presentation in ui/editors/cells.
 */

import { useEffect, useRef, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import {
  CalendarIcon,
  ImageIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Calendar } from "@ai-chat/ui/components/ui/calendar";
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
  BaseCellContext,
  BaseCellValue,
  BaseColumn,
  BaseAttachmentValue,
  BaseRow,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  baseCellText,
  dedupeSelectOptions,
  formatBaseDate,
  isBaseAttachmentValue,
  parseBaseDate,
} from "@ai-chat/base-ui/model/bases-ipc";
import { useBasePlatform } from "../../platform/context";
import { useLocalImageLabel } from "../../media/availability";
import { BaseRelationPicker } from "../panels/base-relation-picker";
import { CELL_CONTROL_CLASS, LocationCellEditor, ScalarCellEditor } from "./base-scalar-editor";

export function BaseCellEditor({
  inputId,
  commitMode,
  column,
  value,
  disabled,
  surface = "field",
  attachmentOwner,
  relationContext,
  relationOptions,
  storedValue,
  onCommit,
}: {
  inputId?: string;
  commitMode?: "immediate" | "form";
  column: BaseColumn;
  value: BaseCellValue | undefined;
  disabled?: boolean;
  surface?: "field" | "cell";
  attachmentOwner?: { chatId: string; incarnationId: string };
  relationContext?: BaseCellContext;
  relationOptions?: BaseRow[];
  storedValue?: BaseCellValue;
  onCommit(value: BaseCellValue | null): Promise<BaseMutationOutcome> | void;
}) {
  if (column.type === "relation") {
    if (relationContext && relationOptions) {
      return (
        <BaseRelationPicker
          inputId={inputId}
          column={column as BaseColumn & { type: "relation" }}
          context={relationContext}
          disabled={disabled}
          onCommit={onCommit}
          options={relationOptions}
          value={typeof storedValue === "string" ? storedValue : undefined}
        />
      );
    }

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
        id={inputId}
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
        id={inputId}
        aria-label={column.name}
        checked={value === true}
        className="size-4 cursor-pointer accent-foreground pointer-coarse:size-5"
        disabled={disabled}
        onChange={(event) => void onCommit(event.target.checked)}
        type="checkbox"
      />
    );
    // The whole cell is the hit area: a label toggles its control on tap without growing the 16px box.
    return surface === "cell" ? (
      <label className="flex h-9 w-full cursor-pointer items-center px-2">{checkbox}</label>
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
          id={inputId}
          aria-label={column.name}
          className={cn(
            surface === "cell"
              ? cn(CELL_CONTROL_CLASS, "justify-between pr-3")
              : "h-7 w-full min-w-24 bg-background px-1.5 text-xs pointer-coarse:h-10"
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
        inputId={inputId}
        column={column}
        disabled={disabled}
        onCommit={onCommit}
        surface={surface}
        value={value}
      />
    );
  }
  if (column.type === "location") {
    return <LocationCellEditor column={column} value={value} disabled={disabled} surface={surface}
      inputId={inputId} commitMode={commitMode} onCommit={onCommit} />;
  }

  return (
    <ScalarCellEditor
      inputId={inputId}
      commitMode={commitMode}
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
            aria-label={t("bases.cell.deleteAttachment", {
              filename: value.filename,
            })}
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
  const availability = useLocalImageLabel(value.localAvailability);
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
        {availability && <span className="block whitespace-normal text-muted-foreground">{availability}</span>}
      </span>
    </span>
  );
}

export function useBaseAttachmentThumbnail(
  owner: { chatId: string; incarnationId: string } | undefined,
  value: BaseAttachmentValue,
  maxEdge = 160
) {
  const { attachments } = useBasePlatform();
  const key = `${owner?.chatId ?? ""}/${owner?.incarnationId ?? ""}/${value.blobId}/${value.revision}/${maxEdge}`;
  const [thumbnail, setThumbnail] = useState({ key: "", url: "" });
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void attachments.preview({ value, owner, maxEdge }, controller.signal).then(result => {
      if (!result) return;
      if (controller.signal.aborted) { result.release(); return; }
      release = result.release;
      setThumbnail({ key, url: result.url });
    }).catch(() => undefined);
    return () => { controller.abort(); release?.(); };
    // The logical attachment identity changes whenever its bytes or owner change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, key]);
  return thumbnail.key === key ? thumbnail.url : "";
}

function DateCellEditor({
  inputId,
  column,
  value,
  disabled,
  surface,
  onCommit,
}: {
  inputId?: string;
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
          id={inputId}
          aria-label={column.name}
          className={cn(
            "font-normal",
            surface === "cell"
              ? cn(CELL_CONTROL_CLASS, "justify-start gap-1.5")
              : "h-7 min-w-28 justify-start gap-1.5 px-1.5 pointer-coarse:h-10"
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

export const EMPTY_SELECT_VALUE = "__base-empty!__";
