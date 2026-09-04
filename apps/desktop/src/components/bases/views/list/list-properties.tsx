/**
 * [INPUT]: Depends on React, lucide, cn, the current Intl locale, shared Base column/value/date contracts plus baseCellText, and the editors useBaseAttachmentThumbnail
 * [OUTPUT]: Provides projectListColumns row projection, selectOptionTone color, listChipText text projection, and the ListSelectDot/ListPropertyChip/ListDateStamp primitives
 * [POS]: The list of attributes of the view/list; Just answer "what a row looks like at a fixed height", without knowing the window layout, grouping and editing mode
 */

import { CheckIcon } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { intlLocale } from "@/lib/i18n-locale";
import type {
  BaseCellValue,
  BaseColumn,
} from "../../../../../shared/bases-ipc";
import {
  isBaseAttachmentValue,
  parseBaseDate,
} from "../../../../../shared/bases-ipc";
import { useBaseAttachmentThumbnail } from "../../editors/cells/base-cell-editor";
import { baseCellText } from "../../../../../shared/bases-ipc";

/* ── 行位投影 ──────────────────────────────────────────────────
 * 密集行只有四个位置：标题、状态点、尾部属性、最右日期。
 * 哪一列落在哪个位置由列类型一次算清，行渲染便不再有 `if (type === …)`——
 * 特殊情况消失在投影里，而不是在每一行里重新判断一遍。
 *
 * 分组列不进尾部属性：它的值已写在组头上，再复述一遍只是噪音。
 * ────────────────────────────────────────────────────────── */

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

/** 尾部属性的可见上限：超出的收进一枚计数 chip，行密度不被列数绑架 */
export const LIST_META_LIMIT = 3;

/* ── 色调 ──────────────────────────────────────────────────────
 * 只有真实存在的 option 才有颜色：值指向已删除的选项时不给色，
 * 于是「这枚点有颜色」恒等于「这个值仍是合法选项」，无需另设一种失效态。
 * 取自 --chart-*：既有 token 自带明暗两套，不为列表另开调色板
 * （深色主题下 chart-3 会自己换成浅蓝，写死 hex 的点在暗背景上会消失）。
 *
 * 按声明次序取色，不按 id 哈希：哈希只保证「稳定」，不保证「相邻可分」——
 * 实测 Todo/Doing/Done 三个哈希连中三枚暖色，三个状态看起来是同一个状态。
 * 次序分配则天然让相邻选项落在不同色相上，这正是分组列最需要的性质。
 * ────────────────────────────────────────────────────────── */

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

/* ── 文本投影 ────────────────────────────────────────────────── */

/**
 * checkbox 的信息全在「有没有」上：勾上时 baseCellText 只给一个 "✓"，
 * 脱离表头便无从知道勾的是什么，故 chip 直接以列名充当值。
 */
export function listChipText(
  column: BaseColumn,
  value: BaseCellValue | undefined
) {
  if (column.type === "checkbox") return value === true ? column.name : "";
  return baseCellText(column, value);
}

/** 本年只给「Jul 31」，跨年才补年份——年份是例外信息，不该恒占宽度。 */
function listDateText(value: BaseCellValue | undefined) {
  const date = parseBaseDate(value);
  if (!date) return typeof value === "string" ? value : "";
  const format = new Intl.DateTimeFormat(intlLocale(), {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });
  return format.format(date);
}

/* ── 原语 ────────────────────────────────────────────────────── */

export const LIST_CHIP_CLASS =
  "inline-flex h-5 min-w-0 max-w-40 shrink items-center gap-1 rounded-full border bg-background px-1.5 text-[11px] text-muted-foreground";

/** 状态点：色即语义，label 走 role="img" 的 aria-label 与 title 两条通道 */
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

/** 日期恒在最右且宽度固定：日期是行的右边界，宽度随内容抖动会让整列失去基线 */
export function ListDateStamp({
  column,
  value,
}: {
  column: BaseColumn;
  value: BaseCellValue | undefined;
}) {
  const text = listDateText(value);
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
