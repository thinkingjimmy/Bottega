/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and React, the useBaseSnapshots rowHistory reading face, i18n, describeBaseFailure (a failed read shows its line, never the raw error), Unified Dialog with the current list of Base columns
 * [OUTPUT]: Provides BaseRowHistoryDialog, showing a rowId's last 50 actor/time/operation entries with per-entry field summaries filtered to that row's cells, falling back to the columnId when a column has been deleted; a workflow entry names its run (Workflow · Run #…)
 * [POS]: Shared Base presentation in ui/editors/panels.
 */

import { formatWorkbench } from "@ai-chat/ui/lib/workbench-copy";
import { useWorkflowCopy } from "../../chrome/workflow-column";
import { useEffect, useMemo, useState } from "react";
import { useBaseSnapshots } from "../../platform/context";
import { useAppTranslation } from "../../platform/i18n";
import { describeBaseFailure, type BaseMutationErrorCopy } from "../../state/base-mutation-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { BaseColumn } from "@ai-chat/base-core/model/bases-ipc";
import type { BaseHistoryEntry } from "@ai-chat/base-core/metadata/history-ledger-schema";

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
  const workbench = useWorkflowCopy();
  const bases = useBaseSnapshots();

  const columnNames = useMemo(
    () => new Map(columns.map((column) => [column.id, column.name])),
    [columns]
  );
  const [entries, setEntries] = useState<BaseHistoryEntry[]>([]);
  const [error, setError] = useState<BaseMutationErrorCopy | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void bases.rowHistory(ownerKey, rowId).then(
      (result) => {
        if (!active) return;
        setEntries(result.entries);
        setError(null);
      },
      async (cause) => {
        const copy = await describeBaseFailure(cause, "history", async () => null);
        if (!active) return;
        setEntries([]);
        setError(copy);
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
        {error ? <p className="text-destructive text-sm">{t(error.copyKey, error.values)}</p> : null}
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
                    <span className="font-medium">{t(`bases.history.actor.${entry.actor}`)}{entry.actor === "workflow" && entry.runId
                      ? ` · ${formatWorkbench(workbench.run.label, { number: entry.runId })}` : ""}</span>
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
