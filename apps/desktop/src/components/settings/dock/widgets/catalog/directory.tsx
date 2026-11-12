/**
 * [INPUT]: The Main-only official catalog bridge, verified static previews and host configuration callbacks.
 * [OUTPUT]: Keyboard-accessible catalog browsing, progress, cancellation, recovery and exact-package retry.
 * [POS]: Acquisition dialog for the Widgets tab and existing instances awaiting a package.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { widgetDirectoryCopy } from "../../../../../../shared/i18n/locales/system-dock/distribution";
import { ImageOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { SettingsAlert, SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type {
  DistributedWidgetId, WidgetDirectoryRow, WidgetDirectorySnapshot, WidgetInstallProgress,
} from "../../../../../../shared/system-dock/widgets/catalog/distribution";

type Transfer = { id?: string; cancelled: boolean };
const bridge = () => window.systemDockSettings!;
const errorKeys = { download: "downloadFailed", verification: "verificationFailed", install: "installFailed" } as const;
const phaseKeys = { downloading: "downloading", verifying: "verifying", installing: "registering" } as const;

export function WidgetDirectoryDialog({ subject, onClose, onAdd, onChanged, onReturnFocus }: {
  subject: { pluginId: DistributedWidgetId; itemId: string } | null;
  onClose(): void; onAdd(id: DistributedWidgetId): Promise<void>; onChanged(): void; onReturnFocus(): void;
}) {
  const { t, i18n } = useAppTranslation();
  const copy = widgetDirectoryCopy(i18n.language);
  const [directory, setDirectory] = useState<WidgetDirectorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<DistributedWidgetId | null>(null);
  const [progress, setProgress] = useState<WidgetInstallProgress | null>(null);
  const [failure, setFailure] = useState<DistributedWidgetId | null>(null);
  const transfer = useRef<Transfer | null>(null);
  const handoff = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const abortRead = useCallback(() => pendingRead.current?.abort(), []);
  const reload = useCallback(async (withCache = false) => {
    abortRead();
    const request = new AbortController();
    pendingRead.current = request;
    setLoading(true);
    try {
      if (withCache) {
        const cached = await bridge().widgetDirectoryControl({ kind: "browse", cached: true });
        if (!request.signal.aborted && cached.kind === "browse" && cached.directory.version !== null) setDirectory(cached.directory);
      }
      const fresh = await bridge().widgetDirectoryControl({ kind: "browse" });
      if (!request.signal.aborted && fresh.kind === "browse") setDirectory(fresh.directory);
    } catch {
      if (!request.signal.aborted) setDirectory(value => ({ version: value?.version ?? null, rows: value?.rows ?? [], state: "unavailable" }));
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [abortRead]);
  const cancel = (operation: Transfer) => {
    operation.cancelled = true;
    if (operation.id) void bridge().widgetDirectoryControl({ kind: "cancel", reviewId: operation.id }).catch(() => undefined);
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => void reload(true));
    return () => {
      cancelAnimationFrame(frame); abortRead();
      if (transfer.current) cancel(transfer.current);
    };
  }, [reload, abortRead]);

  const install = async (row: WidgetDirectoryRow) => {
    if (transfer.current || active) return;
    const operation: Transfer = { cancelled: false };
    transfer.current = operation;
    setActive(row.pluginId);
    setFailure(null);
    setProgress(null);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const review = await bridge().widgetDirectoryControl({ kind: "review", pluginId: row.pluginId, ...(subject ? { itemId: subject.itemId } : {}) });
      if (review.kind !== "review") throw new Error("Widget review is unavailable");
      operation.id = review.reviewId;
      if (operation.cancelled) { cancel(operation); return; }
      const request = bridge().widgetDirectoryControl({ kind: "accept", reviewId: review.reviewId });
      timer = setInterval(() => {
        void bridge().widgetDirectoryControl({ kind: "progress", reviewId: review.reviewId }).then(result => {
          if (transfer.current === operation && result.kind === "progress") setProgress(result.progress);
        }).catch(() => undefined);
      }, 100);
      const result = await request;
      if (operation.cancelled) { onChanged(); return; }
      if (result.kind !== "progress") throw new Error("Widget installation receipt is unavailable");
      setProgress(result.progress);
      if (result.progress.state === "failed") setFailure(row.pluginId);
      if (result.progress.state !== "ready") return;
      onChanged();
      if (!subject && row.status === "install") {
        handoff.current = true;
        await onAdd(row.pluginId);
      } else if (subject) onClose();
      else await reload();
    } catch {
      if (!operation.cancelled) { setFailure(row.pluginId); await reload(); }
    } finally {
      clearInterval(timer);
      if (transfer.current === operation) { transfer.current = null; setActive(null); }
    }
  };

  const recover = async (pluginId: DistributedWidgetId) => {
    if (active) return;
    setActive(pluginId); setFailure(null); setProgress(null);
    try {
      const result = await bridge().widgetDirectoryControl({ kind: "repair", pluginId });
      if (result.kind !== "repair" || !result.repaired) throw new Error("No offline recovery package applies");
      onChanged(); if (subject) onClose(); else await reload();
    } catch { setFailure(pluginId); }
    finally { setActive(null); }
  };

  const rows = directory?.rows.filter(row => !subject || subject.pluginId === row.pluginId) ?? [];
  const status = (row: WidgetDirectoryRow) => {
    if (row.status === "incompatible") {
      if (row.reason === "version") return copy.minimum.replace("{{version}}", row.minimum ?? "");
      return row.reason === "contract" ? copy.contract : copy.runtime;
    }
    if (row.installedVersion) return copy.installedVersion.replace("{{version}}", row.installedVersion);
    return null;
  };
  return <Dialog open onOpenChange={open => { if (!open) { if (transfer.current) cancel(transfer.current); onClose(); } }}>
    <DialogContent data-official-widget-directory="" className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
      onCloseAutoFocus={event => { event.preventDefault(); if (!handoff.current) onReturnFocus(); }}>
      <DialogTitle>{t("systemDock.widgets.directory.title")}</DialogTitle>
      <DialogDescription>{copy.description}</DialogDescription>
      {loading && !directory?.version && <p role="status">{t("common.loading")}</p>}
      {!loading && directory?.state === "unavailable" && <SettingsAlert>
        <span role="alert">{copy.unavailable}</span>
        <SettingsButton variant="ghost" onClick={() => void reload()}>{t("common.retry")}</SettingsButton>
      </SettingsAlert>}
      {!loading && directory?.state === "ready" && rows.length === 0 && <p role="status">{copy.empty}</p>}
      {rows.length > 0 && <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map(row => <li key={row.pluginId} data-official-widget={row.pluginId} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3">
          <div className="grid aspect-[2/1] place-items-center overflow-hidden rounded-lg bg-muted">
            {row.preview ? <img src={row.preview} alt="" className="h-full w-full object-contain" />
              : <ImageOff aria-hidden="true" className="size-5 text-muted-foreground" />}
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{row.name}</h3>
            <p className="text-sm text-muted-foreground">{row.description}</p>
            {status(row) && <p className="text-xs text-muted-foreground" data-widget-directory-status="">{status(row)}</p>}
          </div>
          <div className="mt-auto">
            {row.status !== "incompatible" && row.status !== "installed" &&
              <SettingsButton disabled={!!active || loading || directory?.state !== "ready"} onClick={() => void install(row)}>
                {failure === row.pluginId ? t("common.retry") : row.status === "update" ? copy.update
                  : t(row.status === "repair" ? "systemDock.widgets.install.repair" : "systemDock.widgets.directory.install")}
              </SettingsButton>}
          </div>
          {active === row.pluginId && <div role="status" className="space-y-2 text-sm">
            {t(`systemDock.widgets.install.${progress && progress.state in phaseKeys ? phaseKeys[progress.state as keyof typeof phaseKeys] : "downloading"}`)}
            <progress className="block w-full" max={progress?.total} value={progress?.total ? progress.bytes : undefined}
              aria-label={t("systemDock.widgets.install.downloading")} />
            <SettingsButton variant="ghost" onClick={() => { if (transfer.current) cancel(transfer.current); }}>{t("common.cancel")}</SettingsButton>
          </div>}
          {failure === row.pluginId && <p role="alert" className="text-sm text-destructive">
            {progress?.error ? copy[errorKeys[progress.error]] : copy.unavailable}
          </p>}
        </li>)}
      </ul>}
      {subject && directory?.recovery?.includes(subject.pluginId) &&
        <div className="space-y-2">
          <SettingsButton variant="outline" disabled={!!active} onClick={() => void recover(subject.pluginId)}>{copy.recover}</SettingsButton>
          {failure === subject.pluginId && rows.length === 0 && <p role="alert">{copy.installFailed}</p>}
        </div>}
      <DialogFooter><SettingsButton variant="outline" onClick={() => { if (transfer.current) cancel(transfer.current); onClose(); }}>{t("common.close")}</SettingsButton></DialogFooter>
    </DialogContent>
  </Dialog>;
}
