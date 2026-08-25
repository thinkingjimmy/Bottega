/**
 * [INPUT]: Depends on shared/bases-ipc columns/lines/attachment guard, baseCellText only read projections with visibleBaseColumns, narrowing, and Lucide icon components with LucideIcon types
 * [OUTPUT]: Provides KanbanTone/KanbanChip/kanbanFaceSpec/KanbanCardFace Type, selectTone color analysis, KANBAN_TONE_CHOICES, canbanFaceSpec table-level single-shot projection directory, canbanFaceSpec, canban-columnIds, and select fields to be deleted `+N` Folding) with kanban CardFace single card projection
 * [POS]: The first is the view/kanban project layerlane head with the card only drawing the result it gives, the rendering side no longer branches by column type
 */

import {
  CalendarIcon,
  CheckIcon,
  ImageIcon,
  LinkIcon,
  MapPinIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  BaseAttachmentValue,
  BaseCellContext,
  BaseColumn,
  BaseRow,
} from "../../../../../shared/bases-ipc";
import {
  baseCellText,
  cellValue,
  isBaseAttachmentValue,
  visibleBaseColumns,
} from "../../../../../shared/bases-ipc";

export type KanbanTone = {
  /** 芯片底色 + 字色 */
  chip: string;
  /** lane 头圆点底色 */
  dot: string;
};

/* ── 色调表 ────────────────────────────────────────────────────
 * Tailwind v4 只认字面量类名，故色调必须是静态串表——`bg-${hue}-500/10`
 * 这类拼接在编译期不存在，运行期只会得到一个没有规则的类名。
 *
 * 每档都给足明暗两相：浅相压低底色让字色说话，深相反过来提亮字色，
 * 这样同一枚芯片在两种主题下都保持可读，而不是靠一次「看着还行」赌运气。
 * ────────────────────────────────────────────────────────── */
export const KANBAN_NEUTRAL_TONE: KanbanTone = {
  chip: "bg-muted text-muted-foreground",
  dot: "bg-foreground/25",
};

const TONES: readonly KanbanTone[] = [
  {
    chip: "bg-blue-500/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  {
    chip: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  {
    chip: "bg-green-500/10 text-green-700 dark:bg-green-400/15 dark:text-green-300",
    dot: "bg-green-500",
  },
  {
    chip: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  {
    chip: "bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300",
    dot: "bg-red-500",
  },
  {
    chip: "bg-teal-500/10 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
    dot: "bg-teal-500",
  },
  {
    chip: "bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  {
    chip: "bg-pink-500/10 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300",
    dot: "bg-pink-500",
  },
];

/**
 * 可选色的唯一目录：菜单渲染即遍历这张表，不在 UI 侧再抄一份色名。
 * 别名（sky/yellow/emerald…）只认不发——菜单只发 canonical 名，
 * 于是「选了什么」与「存了什么」永远是同一个词。
 */
/* 只留色名与色调：可读名字归 i18n 目录（bases.kanban.color.*），
   表里再抄一份英文就等于把语言焊死在配色上。 */
export const KANBAN_TONE_CHOICES: readonly {
  color: string;
  tone: KanbanTone;
}[] = [
  { color: "blue", tone: TONES[0]! },
  { color: "amber", tone: TONES[1]! },
  { color: "green", tone: TONES[2]! },
  { color: "violet", tone: TONES[3]! },
  { color: "red", tone: TONES[4]! },
  { color: "teal", tone: TONES[5]! },
  { color: "orange", tone: TONES[6]! },
  { color: "pink", tone: TONES[7]! },
  { color: "gray", tone: KANBAN_NEUTRAL_TONE },
];

/** option.color 的口径：认得的色名落到对应档，认不得的一律回落到序位配色。 */
const NAMED_TONES: Readonly<Record<string, KanbanTone>> = {
  blue: TONES[0]!,
  sky: TONES[0]!,
  amber: TONES[1]!,
  yellow: TONES[1]!,
  green: TONES[2]!,
  emerald: TONES[2]!,
  violet: TONES[3]!,
  purple: TONES[3]!,
  red: TONES[4]!,
  rose: TONES[4]!,
  teal: TONES[5]!,
  cyan: TONES[5]!,
  orange: TONES[6]!,
  pink: TONES[7]!,
  gray: KANBAN_NEUTRAL_TONE,
  grey: KANBAN_NEUTRAL_TONE,
  slate: KANBAN_NEUTRAL_TONE,
  neutral: KANBAN_NEUTRAL_TONE,
};

/* ── 序位配色 ──────────────────────────────────────────────────
 * 未声明 color 的 option 按它在 options 里的**序位**取色，而不是按 id 散列：
 * 序位让相邻 lane 天然拿到不同色相，整块板读起来是一条有序的光谱；
 * 散列则可能把两条相邻 lane 染成近色，还得再加「避让」分支去补救。
 * 「没有颜色」这个特殊情况就此消失——每个 option 永远有色。
 * ────────────────────────────────────────────────────────── */
export function selectTone(
  column: Pick<BaseColumn, "options"> | undefined,
  value: string
): KanbanTone {
  const index = column?.options?.findIndex((option) => option.id === value) ?? -1;
  if (index < 0) return KANBAN_NEUTRAL_TONE;
  const declared = column?.options?.[index]?.color?.trim().toLowerCase();
  return (declared && NAMED_TONES[declared]) || TONES[index % TONES.length]!;
}

export type KanbanChip = {
  key: string;
  /** 值本身不自明时才出现的列名前缀（number/checkbox） */
  label: string;
  text: string;
  tone: KanbanTone;
  Icon?: LucideIcon;
};

export type KanbanFaceSpec = {
  titleColumn?: BaseColumn;
  /** 首个 attachment 列充当封面，其余 attachment 仍走芯片 */
  coverColumn?: BaseColumn;
  chipColumns: BaseColumn[];
  limit: number;
};

export type KanbanCardFace = {
  title: string;
  cover?: BaseAttachmentValue;
  chips: KanbanChip[];
  /** 超出 limit 的字段摘要，供 `+N` 的 title 兜住信息 */
  overflow: string[];
};

/** 没挑过字段时的密度启发：卡片是浏览面不是详情页，四枚之外折起。 */
const DEFAULT_CHIP_LIMIT = 4;

/**
 * 板级只算一次的投影目录：标题列、封面列与芯片列的划分与行无关。
 *
 * `visibleColumnIds` 缺省即全显（与 table/list 同一口径）；标题与封面同样受它管辖——
 * 藏了一列却仍把它印在卡头上，等于设置说了不算。
 */
export function kanbanFaceSpec(
  columns: readonly BaseColumn[],
  groupColumnId: string,
  visibleColumnIds?: readonly string[]
): KanbanFaceSpec {
  const scoped = visibleBaseColumns(columns, visibleColumnIds);
  const titleColumn = scoped.find((column) => column.type === "text");
  const coverColumn = scoped.find((column) => column.type === "attachment");
  const chipColumns = scoped.filter(
    (column) =>
      column.id !== groupColumnId &&
      column.id !== titleColumn?.id &&
      column.id !== coverColumn?.id
  );
  return {
    titleColumn,
    coverColumn,
    chipColumns,
    /* 挑过字段就是明确表态：挑几枚显几枚。把一个被亲手选中的字段折进 `+N`，
     * 等于刚回答完的问题又被藏起来；没挑过才轮到默认的密度启发说话。 */
    limit: visibleColumnIds?.length ? chipColumns.length : DEFAULT_CHIP_LIMIT,
  };
}

export function kanbanCardFace(
  row: BaseRow,
  spec: KanbanFaceSpec,
  context: BaseCellContext
): KanbanCardFace {
  const coverValue = spec.coverColumn
    ? cellValue(row, spec.coverColumn, context)
    : undefined;
  const all = spec.chipColumns.flatMap((column) => {
    const chip = kanbanChip(column, cellValue(row, column, context));
    return chip ? [chip] : [];
  });
  return {
    title: spec.titleColumn
      ? baseCellText(spec.titleColumn, cellValue(row, spec.titleColumn, context))
      : "",
    cover: isBaseAttachmentValue(coverValue) ? coverValue : undefined,
    chips: all.slice(0, spec.limit),
    overflow: all
      .slice(spec.limit)
      .map((chip) => `${chip.label} ${chip.text}`.trim()),
  };
}

/* ── 单值 → 芯片 ──────────────────────────────────────────────
 * 图标与色调是「值的语义」而非「渲染时的判断」：投影一次给全，
 * 卡片侧就只剩一条 map，八类列不必在 JSX 里再长出八个分支。
 *
 * 装饰用表而不是分支：新增列类型只加一行数据。缺席即「无装饰」——
 * text 不在表里，于是它天然落在中性芯片上，不必为它写一条 else。
 *
 * 列名只在值不自明时才占宽度——`2` 需要「轮次」，`设计系统` 不需要。
 * ────────────────────────────────────────────────────────── */
type ChipDecor = (
  chip: KanbanChip,
  column: BaseColumn,
  value: BaseRow["values"][string]
) => KanbanChip;

const CHIP_DECOR: Partial<Record<BaseColumn["type"], ChipDecor>> = {
  select: (chip, column, value) => ({
    ...chip,
    tone: selectTone(column, String(value)),
  }),
  checkbox: (chip, column) => ({
    ...chip,
    label: column.name,
    text: "",
    Icon: CheckIcon,
  }),
  number: (chip, column) => ({ ...chip, label: column.name }),
  date: (chip) => ({ ...chip, Icon: CalendarIcon }),
  url: (chip) => ({ ...chip, text: urlHost(chip.text), Icon: LinkIcon }),
  location: (chip) => ({ ...chip, Icon: MapPinIcon }),
  attachment: (chip) => ({ ...chip, Icon: ImageIcon }),
  formula: (chip, column) => ({ ...chip, label: column.name }),
};

function kanbanChip(
  column: BaseColumn,
  value: BaseRow["values"][string]
): KanbanChip | undefined {
  const text = baseCellText(column, value);
  if (!text) return undefined;
  const chip: KanbanChip = {
    key: column.id,
    label: "",
    text,
    tone: KANBAN_NEUTRAL_TONE,
  };
  return CHIP_DECOR[column.type]?.(chip, column, value) ?? chip;
}

/** 卡片宽度只有一栏，链接显 host 比显整条 URL 更能说明它去哪。 */
function urlHost(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}
