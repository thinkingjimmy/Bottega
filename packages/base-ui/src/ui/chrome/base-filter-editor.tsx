/**
 * [INPUT]: Depends on React, shared Base filter/column contracts, i18n, mutation outcomes and UI select/input/button primitives
 * [OUTPUT]: Provides BaseFilterEditor, the single-condition filter form shared by the toolbar panel and the chart editor
 * [POS]: Shared Base presentation in ui/chrome; the toolbar owns when the panel opens, this file owns the condition form
 */

import { useState } from "react";
import { useAppTranslation } from "../platform/i18n";
import type { BaseMutationOutcome } from "../state/base-mutation-error";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import type {
  BaseCellValue,
  BaseColumnType,
  BaseFilter,
  BaseFilterComparison,
  BaseMeta,
} from "@ai-chat/base-ui/model/bases-ipc";
import { dedupeSelectOptions, isBaseAttachmentValue } from "@ai-chat/base-ui/model/bases-ipc";

type FilterOperator = BaseFilterComparison["operator"];

const FILTER_OPERATORS: Array<{
  value: FilterOperator;
  symbol?: string;
}> = [
  { value: "contains" },
  { value: "eq", symbol: "=" },
  { value: "neq", symbol: "≠" },
  { value: "gt", symbol: ">" },
  { value: "gte", symbol: "≥" },
  { value: "lt", symbol: "<" },
  { value: "lte", symbol: "≤" },
  { value: "is-empty" },
  { value: "not-empty" },
];

export function BaseFilterEditor({
  columns,
  filter,
  busy,
  onFilter,
}: {
  columns: BaseMeta["columns"];
  filter?: BaseFilter;
  busy: boolean;
  onFilter(filter?: BaseFilter): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const condition = filter?.kind === "condition" ? filter : undefined;
  const [columnId, setColumnId] = useState(
    condition?.columnId ?? columns[0]?.id ?? ""
  );
  const [operator, setOperator] = useState<FilterOperator>(
    condition?.operator ?? "contains"
  );
  const [rawValue, setRawValue] = useState(
    condition && "value" in condition
      ? filterValueText(condition.value)
      : ""
  );
  const [validation, setValidation] = useState("");
  const needsValue = operator !== "is-empty" && operator !== "not-empty";
  const selectedColumn = columns.find((column) => column.id === columnId);
  const operators =
    selectedColumn?.type === "attachment"
      ? FILTER_OPERATORS.filter(
          ({ value }) => value === "is-empty" || value === "not-empty"
        )
      : FILTER_OPERATORS;
  if (!columns.length) {
    return (
      <span className="text-muted-foreground text-xs">
        {t("bases.filter.noColumns")}
      </span>
    );
  }
  const apply = () => {
    try {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) throw new Error("column");
      const next = buildBaseFilterCondition(
        column.type === "formula"
          ? column.formula?.resultType === "number"
            ? "number"
            : column.formula?.resultType === "boolean"
              ? "checkbox"
              : "text"
          : column.type,
        columnId,
        operator,
        rawValue
      );
      setValidation("");
      void onFilter(next);
    } catch (cause) {

      setValidation(
        cause instanceof Error
          ? t(`bases.filter.error.${cause.message}`, {
              defaultValue: cause.message,
            })
          : String(cause)
      );
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Select
        disabled={busy}
        onValueChange={(next) => {
          setColumnId(next);
          const nextColumn = columns.find((column) => column.id === next);
          if (nextColumn?.type === "attachment") setOperator("is-empty");
          setRawValue("");
          setValidation("");
        }}
        value={columnId}
      >
        <SelectTrigger
          aria-label={t("bases.filter.column")}
          className="h-7 min-w-24 bg-background px-2 text-xs pointer-coarse:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {columns.map((column) => (
            <SelectItem key={column.id} value={column.id}>
              {column.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        disabled={busy}
        onValueChange={(next) => setOperator(next as FilterOperator)}
        value={operator}
      >
        <SelectTrigger
          aria-label={t("bases.filter.operator")}
          className="h-7 bg-background px-2 text-xs pointer-coarse:h-9"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.symbol ?? t(`bases.filter.operatorLabel.${item.value}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && selectedColumn?.type === "select" ? (
        <Select
          disabled={busy}
          onValueChange={setRawValue}
          value={rawValue}
        >
          <SelectTrigger
            aria-label={t("bases.filter.value")}
            className="h-7 min-w-24 bg-background px-2 text-xs pointer-coarse:h-9"
          >
            <SelectValue placeholder={t("bases.filter.valuePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {dedupeSelectOptions(selectedColumn.options).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : needsValue ? (
        <Input
          aria-label={t("bases.filter.value")}
          className="h-7 min-w-24 flex-1 text-xs pointer-coarse:h-9"
          disabled={busy}
          onChange={(event) => setRawValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
          }}
          placeholder={t("bases.filter.valuePlaceholder")}
          value={rawValue}
        />
      ) : null}
      <Button
        className="h-7 text-xs pointer-coarse:h-9"
        disabled={busy}
        onClick={apply}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("bases.filter.apply")}
      </Button>
      {filter && (
        <Button
          className="h-7 text-xs pointer-coarse:h-9"
          disabled={busy}
          onClick={() => void onFilter(undefined)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("bases.filter.clear")}
        </Button>
      )}
      {filter && filter.kind !== "condition" && (
        <span className="text-muted-foreground text-[10px]">
          {t("bases.filter.compoundHint")}
        </span>
      )}
      {validation && (
        <span role="alert" className="text-destructive text-[10px]">
          {validation}
        </span>
      )}
    </div>
  );
}

function buildBaseFilterCondition(
  columnType: BaseColumnType,
  columnId: string,
  operator: FilterOperator,
  rawValue: string
): BaseFilterComparison {
  if (
    columnType === "attachment" &&
    operator !== "is-empty" &&
    operator !== "not-empty"
  ) {
    throw new Error("attachment");
  }
  if (operator === "is-empty" || operator === "not-empty") {
    return { kind: "condition", columnId, operator };
  }
  const value = parseBaseFilterValue(columnType, rawValue);
  return { kind: "condition", columnId, operator, value };
}

function parseBaseFilterValue(
  columnType: BaseColumnType,
  rawValue: string
): BaseCellValue {
  const value = rawValue.trim();
  if (!value) throw new Error("empty");
  if (columnType === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("number");
    return number;
  }
  if (columnType === "checkbox") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("boolean");
  }
  if (columnType === "location") {
    const [latText, lngText, extra] = value.split(",");
    const lat = Number(latText);
    const lng = Number(lngText);
    if (
      extra !== undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new Error("location");
    }
    return { lat, lng };
  }
  return value;
}

function filterValueText(value: BaseCellValue | undefined) {
  if (value && typeof value === "object") {
    return isBaseAttachmentValue(value)
      ? value.filename
      : `${value.lat},${value.lng}`;
  }
  return String(value ?? "");
}
