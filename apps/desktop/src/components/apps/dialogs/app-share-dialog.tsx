"use client";

/**
 * [INPUT]: Depends on Apps share IPC, Apps i18n, AppDialog primitives, and Base AppRecord data modes
 * [OUTPUT]: Provides the controlled AppShareDialog for gh onboarding, deterministic preview, README warning, and confirmed publish
 * [POS]: GitHub sharing workflow for Apps; open state is owned by the caller because the entry point lives in a dropdown menu that unmounts on close, so the gh probe is driven by the open state rather than by Radix’s own change event; it runs fixed git/gh operations and never starts an Agent turn
 */

import { useEffect, useState } from "react";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  previewAppShare,
  publishAppShare,
  readGhStatus,
  discardAppShare,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import type {
  AppRecord,
  GhStatus,
  ShareDataMode,
  SharePreview,
} from "../../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function AppShareDialog({
  record,
  open,
  onOpenChange,
}: {
  record: AppRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const isReshare = Boolean(record.publishedRepoUrl);
  const [status, setStatus] = useState<GhStatus | null>(null);
  const [mode, setMode] = useState<ShareDataMode>("sample");
  const [repoName, setRepoName] = useState(slug(record.displayName));
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* ============================================================
   * 探测挂在 open 上，而不是挂在 onOpenChange 上
   *
   * 这道弹窗的开关由父组件持有（入口住在一关就卸载的 ⋯ 菜单里），而 Radix
   * 只在自己发起的变化上回调 onOpenChange。于是从 `open` 属性打开时那次探测
   * 永远等不到——status 恒为 null，页脚整条不渲染，用户面前是一张没有出口的
   * 表单。状态是真相，事件不是。
   *
   * 探测因此只有这一处：「没有 status」就是「该探测了」。「重新检测」于是
   * 不必是第二条探测路径，它只是把已知的那一份忘掉——能消失的分支永远比能
   * 写对的分支更可靠。
   * ============================================================ */
  useEffect(() => {
    if (!open || status) return;
    let alive = true;
    void readGhStatus().then(
      (next) => { if (alive) setStatus(next); },
      (cause) => {
        if (alive) setError(errorMessage(cause, t("apps.share.detectFailed")));
      }
    );
    return () => { alive = false; };
  }, [open, status, t]);
  /* 空窗期只有两种：还在探（没结论也没错），或探失败了（错已印在下方）。 */
  const detecting = !status && !error;
  const recheck = () => {
    setStatus(null);
    setError("");
  };
  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(
        await previewAppShare({
          appId: record.id,
          dataMode: mode,
          repoName,
          visibility,
        })
      );
    } catch (cause) {
      setError(errorMessage(cause, t("apps.share.previewFailed")));
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      /* requestId 恒等于 previewId：同一预览的重试按 (kind, requestId) 合流续跑，
       * 瞬时失败（网络断在 push 中途）不会另起新 intent 被在途者 409。 */
      await publishAppShare({
        appId: record.id,
        previewId: preview.previewId,
        confirmedDigest: preview.digest,
        requestId: preview.previewId,
      });
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t("apps.share.publishFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          if (preview) void discardAppShare(preview.previewId);
          setPreview(null);
        }
      }}
    >
      <AppDialogContent className="sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("apps.share.title")}</DialogTitle>
          <DialogDescription>
            {t("apps.share.description")}
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-3">
        {!status ? (
          detecting ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("apps.share.detecting")}
            </p>
          ) : (
            <Button className="w-fit" onClick={recheck} variant="outline">
              {t("apps.share.recheck")}
            </Button>
          )
        ) : status.state !== "ready" ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p>{status.message}</p>
            <code>brew install gh</code>
            <code>gh auth login</code>
            <Button className="w-fit" onClick={recheck} variant="outline">
              {t("apps.share.recheck")}
            </Button>
          </div>
        ) : preview ? (
          <div className="flex flex-col gap-3 text-sm">
            {preview.readmePlaceholder && (
              <p className="rounded-lg bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
                {t("apps.share.readmePlaceholder")}
              </p>
            )}
            <p>{preview.diffSummary}</p>
            <p>
              {t("apps.share.fileSummary", {
                files: preview.files.length,
                rows: preview.rowCount,
              })}
            </p>
            <SlimScroller asChild>
              <ul className="max-h-40 overflow-y-auto rounded border p-2 font-mono text-xs">
                {preview.files.map((file) => (
                  <li key={file.path}>{file.path} · {file.bytes} B</li>
                ))}
              </ul>
            </SlimScroller>
            {preview.sampleRows.length > 0 && (
              <SlimScroller asChild>
                <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(preview.sampleRows, null, 2)}
                </pre>
              </SlimScroller>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t("apps.share.data")}</span>
              <select
                className="h-9 rounded-md border bg-background px-3"
                onChange={(event) => setMode(event.target.value as ShareDataMode)}
                value={mode}
              >
                <option value="sample">{t("apps.share.sample")}</option>
                <option value="schema">{t("apps.share.schema")}</option>
                <option value="full">{t("apps.share.full")}</option>
              </select>
            </label>
            {isReshare ? (
              <div className="rounded-lg border p-3">
                <p className="font-medium">{t("apps.share.fixedTarget")}</p>
                <p className="break-all text-muted-foreground">
                  {record.publishedRepoUrl}
                </p>
              </div>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">
                    {t("apps.share.repositoryName")}
                  </span>
                  <Input
                    onChange={(event) => setRepoName(event.target.value)}
                    value={repoName}
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    checked={visibility === "private"}
                    onChange={(event) =>
                      setVisibility(event.target.checked ? "private" : "public")
                    }
                    type="checkbox"
                  />
                  {t("apps.share.privateRepository")}
                </label>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        </AppDialogBody>
        {status?.state === "ready" && (
          <DialogFooter className="mt-4 shrink-0">
            {preview && (
              <Button
                disabled={busy}
                onClick={() => {
                  void discardAppShare(preview.previewId);
                  setPreview(null);
                }}
                variant="outline"
              >
                {t("common.back")}
              </Button>
            )}
            <Button
              disabled={
                busy || (!preview && !isReshare && !repoName.trim())
              }
              onClick={() => void (preview ? publish() : prepare())}
            >
              {busy
                ? t("apps.share.processing")
                : preview
                  ? t("apps.share.confirmPublish")
                  : t("apps.share.generatePreview")}
            </Button>
          </DialogFooter>
        )}
      </AppDialogContent>
    </Dialog>
  );
}

function slug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "shared-app"
  );
}
