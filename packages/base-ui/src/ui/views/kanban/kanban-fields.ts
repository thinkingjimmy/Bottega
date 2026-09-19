/**
 * [INPUT]: Depends on shared/bases-ipc column/row/attachment types, the baseCellText/cellValue read-only projections and visibleBaseColumns narrowing, and Lucide icon components typed as LucideIcon
 * [OUTPUT]: Provides KanbanTone/KanbanChip/KanbanFaceSpec/KanbanCardFace types, selectTone color resolution, KANBAN_TONE_CHOICES (the canonical color-name catalog), kanbanFaceSpec (board-level title/cover/chip-column projection), and kanbanCardFace (per-row card projection with `+N` overflow)
 * [POS]: Shared Base presentation in ui/views/kanban.
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
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  baseCellText,
  cellValue,
  isBaseAttachmentValue,
  visibleBaseColumns,
} from "@ai-chat/base-ui/model/bases-ipc";

export type KanbanTone = {

  chip: string;

  dot: string;
};

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

  label: string;
  text: string;
  tone: KanbanTone;
  Icon?: LucideIcon;
};

export type KanbanFaceSpec = {
  titleColumn?: BaseColumn;

  coverColumn?: BaseColumn;
  chipColumns: BaseColumn[];
  limit: number;
};

export type KanbanCardFace = {
  title: string;
  cover?: BaseAttachmentValue;
  chips: KanbanChip[];

  overflow: string[];
};

const DEFAULT_CHIP_LIMIT = 4;

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

function urlHost(value: string) {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}
