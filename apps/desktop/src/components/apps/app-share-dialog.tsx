"use client";

/**
 * [INPUT]: Depends on Apps share IPC, Apps i18n, AppDialog primitives, and Base AppRecord data modes
 * [OUTPUT]: Provides the controlled AppShareDialog for gh onboarding, deterministic preview, README warning, and confirmed publish
 * [POS]: GitHub sharing workflow for Apps; open state is owned by the caller because the entry point lives in a dropdown menu that unmounts on close; it runs fixed git/gh operations and never starts an Agent turn
 */

import { useState } from "react";
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
} from "../../../shared/apps-ipc";
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

  const detect = async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await readGhStatus());
    } catch (cause) {
      setError(errorMessage(cause, t("apps.share.detectFailed")));
    } finally {
      setBusy(false);
    }
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
        if (next && !status) void detect();
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
        {status && status.state !== "ready" ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p>{status.message}</p>
            <code>brew install gh</code>
            <code>gh auth login</code>
            <Button disabled={busy} onClick={() => void detect()} variant="outline">
              {busy ? t("apps.share.detecting") : t("apps.share.recheck")}
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
