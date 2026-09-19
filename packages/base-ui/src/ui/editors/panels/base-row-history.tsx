"use client";

/**
 * [INPUT]: Depends on React, the useBaseSnapshots rowHistory reading face, i18n, Unified Dialog with the current list of Base columns
 * [OUTPUT]: Provides BaseRowHistoryDialog, showing a rowId's last 50 actor/time/operation entries with per-entry field summaries filtered to that row's cells, falling back to the columnId when a column has been deleted
 * [POS]: Shared Base presentation in ui/editors/panels.
 */

import { useEffect, useMemo, useState } from "react";
import { useBaseSnapshots } from "@ai-chat/base-ui/ui/platform/context";
import { useAppTranslation } from "../../platform/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { BaseColumn } from "@ai-chat/base-ui/model/bases-ipc";
import type { BaseHistoryEntry } from "@ai-chat/base-ui/metadata/history-ledger-schema";

export function BaseRowHistoryDialog({
  columns,
  open,
  ownerKey,
  rowId,
  onOpenChange,
}: {
  columns: readonly BaseColumn[];
  open: boolean;
  ownerKey: string;
  rowId: string;
  onOpenChange(open: boolean): void;
}) {
  const { t, i18n } = useAppTranslation();
  const bases = useBaseSnapshots();

  const columnNames = useMemo(
    () => new Map(columns.map((column) => [column.id, column.name])),
    [columns]
  );
  const [entries, setEntries] = useState<BaseHistoryEntry[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    void bases.rowHistory(ownerKey, rowId).then(
      (result) => {
        if (!active) return;
        setEntries(result.entries);
        setError("");
      },
      (cause) => {
        if (!active) return;
        setEntries([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => { active = false; };
  }, [bases, open, ownerKey, rowId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bases.history.title")}</DialogTitle>
          <DialogDescription>{t("bases.history.description", { id: rowId })}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        {!error && !entries.length ? (
          <p className="py-6 text-center text-muted-foreground text-sm">{t("bases.history.empty")}</p>
        ) : (
          <ol className="divide-y">
            {entries.map((entry, index) => {

              const fields = (entry.cells ?? [])
                .filter((cell) => cell.rowId === rowId)
                .flatMap((cell) => cell.columnIds)
                .map((columnId) => columnNames.get(columnId) ?? columnId);
              return (
                <li className="space-y-1 py-3 text-sm" key={`${entry.at}:${index}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{t(`bases.history.actor.${entry.actor}`)}</span>
                    <time className="text-muted-foreground text-xs tabular-nums">
                      {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(entry.at)}
                    </time>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("bases.history.operation", { operation: entry.operation })}
                  </p>
                  {fields.length ? (
                    <p className="text-muted-foreground text-xs">
                      {t("bases.history.fields", { fields: fields.join(", ") })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
