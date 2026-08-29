"use client";

/**
 * [INPUT]: Depends on a canonical BaseCellContext, full-row relation options, relation column metadata, i18n, and bounded popover controls
 * [OUTPUT]: Provides searchable single-relation selection with canonical labels, 200-row rendering bounds, empty state, and true dangling-reference display
 * [POS]: The relation v1 editor panel; it never derives lookup authority from visible rows or columns and does not implement cross-Base relations
 */

import { useMemo, useState } from "react";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import {
  baseCellText,
  cellValue,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
} from "../../../../../shared/bases-ipc";
import { deletedRelationText } from "../../../../../shared/base-values";

/* 候选清单只渲染前 200 条：Base 上限一万行，一次把一万个按钮塞进 popover
   会让第一次点击就卡住，而超过两百条也早已不是「用眼睛挑」而是「用搜索找」。
   截断必须说出来——静默少给结果，用户只会以为记录不存在。 */
const RELATION_OPTION_LIMIT = 200;

export function BaseRelationPicker({
  column,
  context,
  disabled,
  options: optionRows,
  value,
  onCommit,
}: {
  column: BaseColumn & { type: "relation" };
  context: BaseCellContext;
  disabled?: boolean;
  options: BaseRow[];
  value?: string;
  onCommit(value: string | null): Promise<BaseMutationOutcome> | void;
}) {
  const { t } = useAppTranslation();
  const [query, setQuery] = useState("");
  const columns = [...context.columns.values()];
  const labelColumn =
    columns.find((candidate) => candidate.id === column.relation?.labelColumnId) ??
    columns.find((candidate) => candidate.type === "text");
  /* 候选投影要跑遍全部 rows 取 label（relation 列还会递归求值），
     不 memo 就等于每敲一个字母重算一遍整张表。 */
  const options = useMemo(
    () =>
      optionRows.map((row) => ({
        id: row.id,
        label: labelColumn
          ? baseCellText(labelColumn, cellValue(row, labelColumn, context)) ||
            row.id
          : row.id,
      })),
    [context, labelColumn, optionRows]
  );
  const current = options.find((option) => option.id === value);
  const label = current
    ? current.label
    : value
      ? deletedRelationText(value)
      : t("bases.relation.empty");
  const matches = options.filter((option) =>
    `${option.label}\n${option.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const visible = matches.slice(0, RELATION_OPTION_LIMIT);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={column.name}
          className="h-7 w-full min-w-24 justify-start truncate px-1.5 text-xs"
          disabled={disabled}
          type="button"
          variant="outline"
        >
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 p-2">
        <Input
          aria-label={t("bases.relation.search")}
          autoFocus
          className="h-8 text-xs"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("bases.relation.search")}
          value={query}
        />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted"
            onClick={() => void onCommit(null)}
            type="button"
          >
            {t("bases.relation.clear")}
          </button>
          {visible.map((option) => (
            <button
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted"
              key={option.id}
              onClick={() => void onCommit(option.id)}
              type="button"
            >
              <span className="block truncate">{option.label}</span>
              <span className="block truncate text-muted-foreground text-[10px]">{option.id}</span>
            </button>
          ))}
          {!matches.length ? (
            <p className="px-2 py-4 text-center text-muted-foreground text-xs">{t("bases.relation.noResults")}</p>
          ) : null}
          {matches.length > visible.length ? (
            <p className="px-2 py-2 text-center text-muted-foreground text-[10px]">
              {t("bases.relation.narrowSearch", { count: visible.length })}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
