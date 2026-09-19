"use client";

/**
 * [INPUT]: Depends on a canonical BaseCellContext, full-row relation options, relation column metadata, i18n, bounded popover controls and the shared coarse-pointer hook (no autofocus on touch)
 * [OUTPUT]: Provides searchable single-relation selection with canonical labels, 200-row rendering bounds, empty state, and true dangling-reference display
 * [POS]: Shared Base presentation in ui/editors/panels.
 */

import { useMemo, useState } from "react";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { useAppTranslation } from "../../platform/i18n";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
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
} from "@ai-chat/base-ui/model/bases-ipc";
import { deletedRelationText } from "@ai-chat/base-ui/model/base-values";

const RELATION_OPTION_LIMIT = 200;

export function BaseRelationPicker({
  inputId,
  column,
  context,
  disabled,
  options: optionRows,
  value,
  onCommit,
}: {
  inputId?: string;
  column: BaseColumn & { type: "relation" };
  context: BaseCellContext;
  disabled?: boolean;
  options: BaseRow[];
  value?: string;
  onCommit(value: string | null): Promise<BaseMutationOutcome> | void;
}) {
  const { t } = useAppTranslation();
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState("");

  const labelColumn = useMemo(() => {
    const columns = [...context.columns.values()];
    return (
      columns.find(
        (candidate) => candidate.id === column.relation?.labelColumnId
      ) ?? columns.find((candidate) => candidate.type === "text")
    );
  }, [column.relation?.labelColumnId, context]);

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

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label}\n${option.id}`.toLocaleLowerCase().includes(needle)
    );
  }, [options, query]);
  const visible = matches.slice(0, RELATION_OPTION_LIMIT);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={inputId}
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
          autoFocus={!coarse}
          className="h-8 text-xs pointer-coarse:h-10"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("bases.relation.search")}
          value={query}
        />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          <button
            className="w-full rounded-sm px-2 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted pointer-coarse:min-h-10"
            onClick={() => void onCommit(null)}
            type="button"
          >
            {t("bases.relation.clear")}
          </button>
          {visible.map((option) => (
            <button
              className="w-full rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted pointer-coarse:min-h-10"
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
