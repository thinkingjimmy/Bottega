/**
 * [INPUT]: Depends on browser/Node shared Date, Base select with persistent attachments referring to the original value
 * [OUTPUT]: Provides Base unit/column/line type with attachment/formula, text-only projections, suspension relation, only words, first-id-wins select to be re-analysed/formatted with strict date
 * [POS]: The Base unit semantic module of shared values; bases-ipc redirects a stable API, main and renderer sharing the same truth
 */

export type BaseColumnType =
  | "text"
  | "number"
  | "date"
  | "select"
  | "checkbox"
  | "url"
  | "location"
  | "attachment"
  | "formula"
  | "relation";

export type BaseLocation = { lat: number; lng: number };

export type BaseSelectOption = {
  id: string;
  label: string;
  color?: string;
};

export type BaseAttachmentValue = {
  kind: "attachment";
  attachmentId: string;
  blobId: string;
  filename: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  byteLength: number;
  width: number;
  height: number;
  revision: string;
};

export type BaseCellValue =
  | string
  | number
  | boolean
  | BaseLocation
  | BaseAttachmentValue;

export type BaseColumn = {
  id: string;
  name: string;
  type: BaseColumnType;
  options?: BaseSelectOption[];
  formula?: {
    expression: string;
    resultType: "number" | "text" | "boolean";
    invalidReferences?: string[];
  };
  relation?: {
    labelColumnId: string | null;
  };
};

export type BaseRow = {
  id: string;
  values: Partial<Record<string, BaseCellValue>>;
};

export function isBaseAttachmentValue(
  value: BaseCellValue | undefined
): value is BaseAttachmentValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      "kind" in value &&
      value.kind === "attachment"
  );
}

/* ============================================================================
 * 悬垂 relation 的唯一说法
 *
 * 「目标记录已不在了」这件事曾有三种写法：canonical 投影一句英文、cell
 * 编辑器一条 i18n 键、relation picker 又一条。同一个事实在导出的 CSV 里
 * 是一种字，在屏幕上是另一种字——所见即所导于是不成立。
 *
 * 收成一处，产品主语言中文即 canonical：投影进搜索/CSV/XLSX 的是它，
 * 画在屏幕上的也是它。UI 不再翻译，只是把同一个函数的结果放上去。
 * 前 8 位足以让人认出是哪条记录，也短到能塞进一枚单元格。
 * ========================================================================== */

export const DELETED_RELATION_PREFIX = "#DELETED_RELATION:";

const DELETED_RELATION_ID_LENGTH = 8;

export function deletedRelationText(targetId: string) {
  return `已删除的记录 (${targetId.slice(0, DELETED_RELATION_ID_LENGTH)})`;
}

/** 十类单元格的 canonical searchable/read-only 文本投影。 */
export function baseCellText(
  column: Pick<BaseColumn, "type"> & {
    readonly options?: readonly BaseSelectOption[];
  },
  value: BaseCellValue | undefined
): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "object") {
    return isBaseAttachmentValue(value)
      ? value.filename
      : `${value.lat}, ${value.lng}`;
  }
  if (column.type === "select") {
    return (
      column.options?.find((option) => option.id === value)?.label ??
      String(value)
    );
  }
  if (column.type === "checkbox") return value === true ? "✓" : "";
  if (column.type === "relation" && typeof value === "string") {
    return value.startsWith(DELETED_RELATION_PREFIX)
      ? deletedRelationText(value.slice(DELETED_RELATION_PREFIX.length))
      : value;
  }
  return String(value);
}

export function dedupeSelectOptions(
  options: readonly BaseSelectOption[] = []
): BaseSelectOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

export function parseBaseDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  const suffix = match[4];
  if (!suffix) return date;
  if (
    !/^T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(
      suffix
    )
  ) {
    return undefined;
  }
  return Number.isNaN(Date.parse(value)) ? undefined : new Date(value);
}

export function formatBaseDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
