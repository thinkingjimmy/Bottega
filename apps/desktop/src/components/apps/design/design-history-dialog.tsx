"use client";

/**
 * [INPUT]: Depends on trusted Apps client Design candidate/import/list/restore IPC, React identity refs, UI Dialog/Button/DropdownMenu, and localized copy
 * [OUTPUT]: Provides DesignCanvasMenuItems, DesignHistoryDialog and DesignHistoryButton — the App-level home for import and restore, with per-surface lists, stale-response fencing and lease-safe convergence preserved
 * [POS]: Trusted Design chrome; it is the only renderer mutation entry for canvas history, now mounted in App chrome rather than over the canvas
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadIcon, HistoryIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  importDesignCanvas,
  listDesignImportCandidates,
  listDesignFiles,
  listDesignVersions,
  onAppsEvent,
  restoreDesignVersion,
} from "@/lib/apps-client";
import type { DesignCanvasVersion } from "../../../../shared/apps-ipc";

type Lease = { appId: string; appSurfaceLeaseId: string };

const EMPTY_LIST: readonly string[] = [];

/* ============================================================
 * 一个入口只取它自己要念的那一份
 *
 * 两处入口（App 菜单与侧栏按钮）各自持有一份实时清单，因为它们从不同时
 * 挂载，共享 store 只会多一个需要失效的真相源。
 *
 * 但「一份」不等于「同一条 IPC 拉两样东西」：⋯ 菜单只问「有什么可导入」，
 * 已托管文件是恢复弹窗的问题。两条绑在一起，等于每次展开菜单都替一个没
 * 打开的弹窗取一次数。load 由调用方以模块级函数传入——身份恒定，effect
 * 因而不会因为父级重渲染再拉一遍。
 * ============================================================ */
function useDesignCanvasList(
  { appId, appSurfaceLeaseId }: Lease,
  load: (lease: Lease) => Promise<string[]>
) {
  const [items, setItems] = useState<readonly string[]>(EMPTY_LIST);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await load({ appId, appSurfaceLeaseId });
        if (!active) return;
        setItems(next);
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const unsubscribe = onAppsEvent((event) => {
      if (event.type === "design-canvases-changed" && event.appId === appId) void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [appId, appSurfaceLeaseId, load]);
  return { items, error };
}

/** ⋯ 菜单里的两项。导入是子菜单——它只要一个坐标，不值得一个弹窗。 */
export function DesignCanvasMenuItems({
  appId,
  appSurfaceLeaseId,
  onImported,
  onOpenHistory,
}: Lease & { onImported(): void; onOpenHistory(): void }) {
  const { t } = useAppTranslation();
  const { items: candidates } = useDesignCanvasList(
    { appId, appSurfaceLeaseId },
    listDesignImportCandidates
  );
  const runImport = (file: string) => {
    void importDesignCanvas({ appId, appSurfaceLeaseId, file }).then(onImported);
  };
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <DownloadIcon />
          {t("apps.designImport")}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-56">
          {candidates.length === 0 ? (
            <DropdownMenuItem disabled>{t("apps.designNoImportCandidates")}</DropdownMenuItem>
          ) : (
            candidates.map((candidate) => (
              <DropdownMenuItem key={candidate} onSelect={() => runImport(candidate)}>
                {candidate}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={onOpenHistory}>
        <HistoryIcon />
        {t("apps.designHistory")}
      </DropdownMenuItem>
    </>
  );
}

function PickerRow({
  checked,
  label,
  hint,
  value,
  onSelect,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  /* 行的身份，而不是它的显示文本：版本的显示文本是本地化时间戳，
     没有任何调用方能拿它来指名一行。 */
  value: string;
  onSelect(): void;
}) {
  return (
    <button
      aria-pressed={checked}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted aria-pressed:bg-muted aria-pressed:font-medium"
      data-value={value}
      onClick={onSelect}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-muted-foreground text-[0.625rem]">{hint}</span>}
    </button>
  );
}

/**
 * 恢复的弹窗形制来自它自身的性质：它要两个坐标（哪个文件、哪个版本），
 * 它是破坏性的，而且罕用。三条都不适合常驻 chrome 里的两个下拉。
 * 确认做成就地两段式，而不是原生 confirm——弹窗之上再弹一个系统框，
 * 会把「这一步很重」表达成「这个程序很旧」。
 */
export function DesignHistoryDialog({
  appId,
  appSurfaceLeaseId,
  onRestored,
  open,
  onOpenChange,
}: Lease & { onRestored(): void; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useAppTranslation();
  const { items: files, error: listError } = useDesignCanvasList(
    { appId, appSurfaceLeaseId },
    listDesignFiles
  );
  const [file, setFile] = useState("");
  const [versions, setVersions] = useState<DesignCanvasVersion[]>([]);
  const [versionsFile, setVersionsFile] = useState("");
  const [versionId, setVersionId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef("");
  const requestRef = useRef(0);

  /* 换文件即作废版本身份：迟到的响应不得回填到另一个文件的清单上。 */
  const selectFile = useCallback((next: string) => {
    if (fileRef.current === next) return;
    fileRef.current = next;
    requestRef.current += 1;
    setFile(next);
    setVersions([]);
    setVersionsFile("");
    setVersionId("");
    setConfirming(false);
  }, []);

  const loadVersions = useCallback(async (target: string) => {
    if (!target) return false;
    const request = ++requestRef.current;
    const next = await listDesignVersions({ appId, appSurfaceLeaseId, file: target });
    if (request !== requestRef.current || fileRef.current !== target) return false;
    setError("");
    setVersions(next);
    setVersionsFile(target);
    setVersionId(next[0]?.versionId ?? "");
    return true;
  }, [appId, appSurfaceLeaseId]);

  useEffect(() => {
    if (!files.includes(fileRef.current)) selectFile(files[0] || "");
  }, [files, selectFile]);

  useEffect(() => {
    if (!open || !file) return;
    void loadVersions(file)
      .then((loaded) => {
        if (loaded) setError("");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [open, file, loadVersions]);

  const restorable = versionsFile === file
    && versions.some((item) => item.versionId === versionId);

  const runRestore = () => {
    const targetFile = fileRef.current;
    const targetVersionId = versionId;
    if (versionsFile !== targetFile) return;
    if (!versions.some((item) => item.versionId === targetVersionId)) return;
    setBusy(true);
    setError("");
    void restoreDesignVersion({
      appId, appSurfaceLeaseId, versionId: targetVersionId, confirmed: true,
    })
      .then(async () => {
        if (await loadVersions(targetFile)) onRestored();
        setConfirming(false);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  const shown = error || listError;
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <AppDialogContent className="sm:max-w-xl" data-testid="design-history-dialog">
        <DialogHeader>
          <DialogTitle>{t("apps.designHistory")}</DialogTitle>
          <DialogDescription>{t("apps.designHistoryHint")}</DialogDescription>
        </DialogHeader>
        <AppDialogBody className="grid gap-4">
          <section className="grid gap-1.5">
            <p className="font-medium text-muted-foreground text-xs">{t("apps.designCanvasFile")}</p>
            <div className="max-h-32 overflow-auto rounded-md border p-1" data-testid="design-history-files">
              {files.map((item) => (
                <PickerRow
                  checked={item === file}
                  key={item}
                  label={item}
                  onSelect={() => selectFile(item)}
                  value={item}
                />
              ))}
            </div>
          </section>
          <section className="grid gap-1.5">
            <p className="font-medium text-muted-foreground text-xs">{t("apps.designVersion")}</p>
            <div className="max-h-48 overflow-auto rounded-md border p-1" data-testid="design-history-versions">
              {versions.length === 0 ? (
                <p className="px-2 py-3 text-center text-muted-foreground text-xs">
                  {t("apps.designNoVersions")}
                </p>
              ) : (
                versions.map((version) => (
                  <PickerRow
                    checked={version.versionId === versionId}
                    hint={version.source}
                    key={version.versionId}
                    label={new Date(version.createdAt).toLocaleString()}
                    onSelect={() => {
                      setVersionId(version.versionId);
                      setConfirming(false);
                    }}
                    value={version.versionId}
                  />
                ))
              )}
            </div>
          </section>
          {shown && <p className="text-destructive text-xs" role="alert">{shown}</p>}
          <div className="flex items-center justify-end gap-2">
            {confirming ? (
              <>
                <span className="mr-auto text-muted-foreground text-xs">
                  {t("apps.designRestoreConfirm")}
                </span>
                <Button onClick={() => setConfirming(false)} variant="ghost">
                  {t("common.cancel")}
                </Button>
                <Button disabled={busy} onClick={runRestore} variant="destructive">
                  {t("apps.designRestore")}
                </Button>
              </>
            ) : (
              <Button
                disabled={busy || !restorable}
                onClick={() => setConfirming(true)}
                variant="outline"
              >
                <HistoryIcon />
                {t("apps.designRestore")}
              </Button>
            )}
          </div>
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  );
}

/** 侧栏没有 App 头部的 ⋯，给它一颗自持状态的入口，功能不因面而缺失。 */
export function DesignHistoryButton(props: Lease & { onRestored(): void }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        aria-label={t("apps.designHistory")}
        onClick={() => setOpen(true)}
        size="icon-sm"
        variant="ghost"
      >
        <HistoryIcon />
      </Button>
      <DesignHistoryDialog {...props} onOpenChange={setOpen} open={open} />
    </>
  );
}
