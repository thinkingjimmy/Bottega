"use client";

/**
 * [INPUT]: Depends on Apps share IPC, AppDialogContent, Base AppRecord with three modes of tables
 * [OUTPUT]: Provides AppShareDialog; gh onboarding, preview of the data on the certainty, README, alert and confirmation releases
 * [POS]: The GitHub product sharing process for components/apps; There's no Agent Turn at all
 */

import { useState } from "react";
import { Share2Icon } from "lucide-react";
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
  DialogTrigger,
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

export function AppShareDialog({ record }: { record: AppRecord }) {
  const isReshare = Boolean(record.publishedRepoUrl);
  const [open, setOpen] = useState(false);
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
      setError(errorMessage(cause, "GitHub CLI 检测失败"));
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
      setError(errorMessage(cause, "分享预览失败"));
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
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause, "发布失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && !status) void detect();
        if (!next) {
          if (preview) void discardAppShare(preview.previewId);
          setPreview(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          aria-label="Share 到 GitHub"
          size="icon-sm"
          variant="ghost"
        >
          <Share2Icon />
        </Button>
      </DialogTrigger>
      <AppDialogContent className="sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Share 到 GitHub</DialogTitle>
          <DialogDescription>
            产品固定生成包并运行 git/gh；不会启动 Agent，也不会包含 App 配置。
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-3">
        {status && status.state !== "ready" ? (
          <div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
            <p>{status.message}</p>
            <code>brew install gh</code>
            <code>gh auth login</code>
            <Button disabled={busy} onClick={() => void detect()} variant="outline">
              {busy ? "检测中…" : "重新检测"}
            </Button>
          </div>
        ) : preview ? (
          <div className="flex flex-col gap-3 text-sm">
            {preview.readmePlaceholder && (
              <p className="rounded-lg bg-amber-500/10 p-3 text-amber-800 dark:text-amber-300">
                README 仍是骨架。建议先在编辑 chat 完善介绍与使用方法；也可继续发布。
              </p>
            )}
            <p>{preview.diffSummary}</p>
            <p>{preview.files.length} 个文件，base.json {preview.rowCount} 行</p>
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
              <span className="font-medium">数据</span>
              <select
                className="h-9 rounded-md border bg-background px-3"
                onChange={(event) => setMode(event.target.value as ShareDataMode)}
                value={mode}
              >
                <option value="sample">确定性示例数据</option>
                <option value="schema">仅结构</option>
                <option value="full">全部真实数据（确认知情）</option>
              </select>
            </label>
            {isReshare ? (
              <div className="rounded-lg border p-3">
                <p className="font-medium">发布目标（固定）</p>
                <p className="break-all text-muted-foreground">
                  {record.publishedRepoUrl}
                </p>
              </div>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="font-medium">仓库名</span>
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
                  私有仓库
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
                返回
              </Button>
            )}
            <Button
              disabled={
                busy || (!preview && !isReshare && !repoName.trim())
              }
              onClick={() => void (preview ? publish() : prepare())}
            >
              {busy ? "处理中…" : preview ? "确认发布" : "生成预览"}
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
