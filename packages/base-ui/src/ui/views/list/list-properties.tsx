/**
 * [INPUT]: Depends on React, lucide, cn, the current Intl locale, shared Base column/value/date contracts plus baseCellText, and the editors useBaseAttachmentThumbnail
 * [OUTPUT]: Provides projectListColumns row projection, selectOptionTone color, listChipText text projection, and the ListSelectDot/ListPropertyChip/ListDateStamp primitives
 * [POS]: Shared Base presentation in ui/views/list.
 */

import { CheckIcon } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation as useTranslation } from "../../platform/i18n";
import type {
  BaseCellValue,
  BaseColumn,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  isBaseAttachmentValue,
  parseBaseDate,
} from "@ai-chat/base-ui/model/bases-ipc";
import { useBaseAttachmentThumbnail } from "../../editors/cells/base-cell-editor";
import { baseCellText } from "@ai-chat/base-ui/model/bases-ipc";

export type ListColumnProjection = {
  title?: BaseColumn;
  status?: BaseColumn;
  date?: BaseColumn;
  meta: BaseColumn[];
};

export function projectListColumns(
  columns: BaseColumn[],
  groupByColumnId?: string
): ListColumnProjection {
  const [title, ...rest] = columns;
  const status =
    rest.find(
      (column) => column.id === groupByColumnId && column.type === "select"
    ) ?? rest.find((column) => column.type === "select");
  const date = rest.find((column) => column.type === "date");
  const grouped = status?.id === groupByColumnId ? status : undefined;
  return {
    title,
    status,
    date,
    meta: rest.filter((column) => column !== date && column !== grouped),
  };
}

export const LIST_META_LIMIT = 3;

const LIST_TONES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-3)",
  "var(--chart-5)",
];

export function selectOptionTone(
  column: BaseColumn | undefined,
  value: BaseCellValue | undefined
) {
  if (!column || typeof value !== "string" || !value) return undefined;
  const index =
    column.options?.findIndex((candidate) => candidate.id === value) ?? -1;
  if (index < 0) return undefined;
  return column.options?.[index]?.color ?? LIST_TONES[index % LIST_TONES.length];
}

export function listChipText(
  column: BaseColumn,
  value: BaseCellValue | undefined
) {
  if (column.type === "checkbox") return value === true ? column.name : "";
  return baseCellText(column, value);
}

function listDateText(value: BaseCellValue | undefined, locale: string) {
  const date = parseBaseDate(value);
  if (!date) return typeof value === "string" ? value : "";
  const format = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });
  return format.format(date);
}

export const LIST_CHIP_CLASS =
  "inline-flex h-5 min-w-0 max-w-40 shrink items-center gap-1 rounded-full border bg-background px-1.5 text-[11px] text-muted-foreground";

export function ListSelectDot({
  label,
  tone,
  size = "md",
}: {
  label: string;
  tone?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-label={label}
      className="flex shrink-0 items-center justify-center"
      role="img"
      title={label}
    >
      <span
        className={cn(
          "rounded-full",
          size === "sm" ? "size-1.5" : "size-2.5",
          !tone && "border border-muted-foreground/60 border-dashed"
        )}
        style={tone ? { backgroundColor: tone } : undefined}
      />
    </span>
  );
}

export function ListPropertyChip({
  column,
  owner,
  value,
}: {
  column: BaseColumn;
  owner?: { chatId: string; incarnationId: string };
  value: BaseCellValue | undefined;
}) {
  if (column.type === "attachment" && isBaseAttachmentValue(value)) {
    return <ListAttachmentChip owner={owner} value={value} />;
  }
  const text = listChipText(column, value);
  if (!text) return null;
  const tone = selectOptionTone(column, value);
  return (
    <span className={LIST_CHIP_CLASS} title={`${column.name}: ${text}`}>
      {column.type === "select" && <ListSelectDot label={text} size="sm" tone={tone} />}
      {column.type === "checkbox" && <CheckIcon className="size-3 shrink-0" />}
      <span className="truncate">{text}</span>
    </span>
  );
}

function ListAttachmentChip({
  owner,
  value,
}: {
  owner?: { chatId: string; incarnationId: string };
  value: Extract<BaseCellValue, { kind: "attachment" }>;
}) {
  const thumbnail = useBaseAttachmentThumbnail(owner, value);
  return (
    <span className={cn(LIST_CHIP_CLASS, "pl-0.5")} title={value.filename}>
      {thumbnail ? (
        <img
          alt=""
          className="size-4 shrink-0 rounded-[3px] object-cover"
          src={thumbnail}
        />
      ) : (
        <span className="size-4 shrink-0 rounded-[3px] bg-muted" />
      )}
      <span className="truncate">{value.filename}</span>
    </span>
  );
}

export function ListDateStamp({
  column,
  value,
}: {
  column: BaseColumn;
  value: BaseCellValue | undefined;
}) {
  const { i18n } = useTranslation();
  const text = listDateText(value, i18n.language || "en");
  return (
    <span
      className="w-20 shrink-0 truncate text-right text-[11px] text-muted-foreground tabular-nums"
      data-list-date={column.id}
      title={text ? `${column.name}: ${text}` : column.name}
    >
      {text}
    </span>
  );
}
