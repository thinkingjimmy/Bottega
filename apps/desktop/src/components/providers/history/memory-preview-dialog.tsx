"use client";

/**
 * [INPUT]: Depends on HistoryMemoryPreview, i18n, and ConfirmationDialog for a single-use grant commit
 * [OUTPUT]: Provides HistoryMemoryPreviewDialog; a delta refreshed after opening must pass a second confirmation against its snapshot digest before commit
 * [POS]: Shared Memory-grant confirmation for providers/history; grants apply once and are neither persisted nor submitted on close
 */

import { useState } from "react";
import type { HistoryMemoryPreview } from "../../../../shared/history-import-ipc";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";

/** 挂载方按 preview 有无条件渲染；本组件只呈现非空 delta。 */
export function HistoryMemoryPreviewDialog({
  preview,
  onClose,
  onCommit,
}: {
  preview: HistoryMemoryPreview;
  onClose(): void;
  onCommit(snapshotId: string, digest: string): Promise<void>;
}) {
  const { t, i18n } = useAppTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formatDate = (value: number | null) => value === null
    ? "—"
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value);
  const commit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onCommit(preview.snapshotId, preview.digest);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={t("history.projectMemoryPreviewTitle")}
      description={
        <div className="space-y-3 text-left">
          <p>{t("history.settingsPreviewSummary", {
            chats: preview.chats,
            turns: preview.turns,
            from: formatDate(preview.from),
            to: formatDate(preview.to),
          })}</p>
          <p>{t("history.settingsPreviewDisclosure")}</p>
          <p>{t("history.memoryRetained")}</p>
          {preview.sharingMode === "personal" && <p>{t("history.personalCrossProject")}</p>}
          <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">{preview.digest}</code>
          {error && <p className="text-destructive" role="alert">{error}</p>}
        </div>
      }
      confirmLabel={t("history.settingsConfirm")}
      cancelLabel={t("common.cancel")}
      busy={busy}
      onConfirm={() => void commit()}
    />
  );
}
