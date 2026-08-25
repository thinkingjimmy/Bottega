/**
 * [INPUT]: Depends on React, shared Base column/value, base cell editor, Dialog/Button/Input with i18n
 * [OUTPUT]: Provides BaseRecordEditor; Save and delete the null entry, and Gallery only accepts the target attachment column and files
 * [POS]: The standard new record surface of bases/editors/cells; Only draft collected, without Base mutation or attachment storage
 */

import { useMemo, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type {
  BaseCellValue,
  BaseColumn,
  BaseRow,
} from "../../../../../shared/bases-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { BaseCellEditor } from "./base-cell-editor";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export function BaseRecordEditor({
  open,
  columns,
  firstColumnId,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  columns: BaseColumn[];
  firstColumnId?: string;
  onOpenChange(open: boolean): void;
  onSave(values: BaseRow["values"], attachment?: File): Promise<void>;
}) {
  const { t } = useAppTranslation();
  const [values, setValues] = useState<BaseRow["values"]>({});
  const [attachment, setAttachment] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ordered = useMemo(
    () => [
      ...columns.filter((column) => column.id === firstColumnId),
      ...columns.filter(
        (column) =>
          column.id !== firstColumnId && column.type !== "attachment"
      ),
    ],
    [columns, firstColumnId]
  );
  const attachmentRequired = ordered[0]?.type === "attachment";

  const close = () => {
    setValues({});
    setAttachment(undefined);
    setError("");
    onOpenChange(false);
  };
  const changeOpen = (next: boolean) => {
    if (next) onOpenChange(true);
    else if (!busy) close();
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(values, attachment);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("bases.record.title")}</DialogTitle>
          <DialogDescription>{t("bases.record.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {ordered.map((column) => (
            <div className="grid gap-1.5 text-xs" key={column.id}>
              <span className="font-medium">{column.name}</span>
              {column.type === "attachment" ? (
                <>
                  <Input
                    accept={IMAGE_TYPES}
                    aria-label={column.name}
                    disabled={busy}
                    onChange={(event) =>
                      setAttachment(event.target.files?.[0] ?? undefined)
                    }
                    type="file"
                  />
                </>
              ) : (
                <BaseCellEditor
                  column={column}
                  disabled={busy}
                  onCommit={(value) =>
                    setValues((current) => {
                      const next = { ...current };
                      if (value === null) delete next[column.id];
                      else next[column.id] = value as BaseCellValue;
                      return next;
                    })
                  }
                  value={values[column.id]}
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => changeOpen(false)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={
              busy ||
              (attachmentRequired && !attachment)
            }
            onClick={() => void save()}
            type="button"
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
