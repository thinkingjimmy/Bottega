"use client";

/**
 * [INPUT]: Depends on Apps share IPC, Apps i18n, AppDialog primitives, and Base AppRecord data modes
 * [OUTPUT]: Provides the controlled AppShareDialog for gh onboarding, a data choice whose consequences ride on the options themselves, deterministic preview, README warning, and confirmed publish behind a footer that exists in every state
 * [POS]: GitHub sharing workflow for Apps; open state is owned by the caller because the entry point lives in a dropdown menu that unmounts on close, so the gh probe is driven by the open state rather than by Radix’s own change event; it runs fixed git/gh operations and never starts an Agent turn
 */

import { CompatibilityReminder } from "../compatibility/reminder";
import { AppCompatibilityRequiredError } from "@/lib/apps-client";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";
import { useEffect, useState } from "react";
import {
  AppDialogBody,
  AppDialogContent,
  DialogChoice,
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
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
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
  const [compatibility, setCompatibility] = useState<AppCompatibilityFailure | null>(null);
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
      if (cause instanceof AppCompatibilityRequiredError) { setCompatibility(cause.compatibility); return; }
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
      if (cause instanceof AppCompatibilityRequiredError) { setCompatibility(cause.compatibility); return; }
      setError(errorMessage(cause, t("apps.share.publishFailed")));
    } finally {
      setBusy(false);
    }
  };

  /* ── 页脚不再挂在探测结果上 ────────────────────────────────────
   * 整条 DialogFooter 此前挂在 status?.state === "ready" 上：gh 还没探完、
   * 或者根本没装，这张弹窗上唯一能退出的东西是右上角那个 24px 的 ×——Esc
   * 与点遮罩都看不见。判断因此从「渲不渲染页脚」下移到「主按钮此刻是谁」：
   * 探测中它失效地待在那里（存在但按不动，比整条消失更能说明「等一下」），
   * 未就绪时它是复检，就绪后才是生成预览。
   * ────────────────────────────────────────────────────────────── */
  const ready = status?.state === "ready";
  const primary = preview
    ? {
        label: t("apps.share.confirmPublish"),
        disabled: busy,
        run: () => void publish(),
      }
    : ready
      ? {
          label: t("apps.share.generatePreview"),
          disabled: busy || (!isReshare && !repoName.trim()),
          run: () => void prepare(),
        }
      : detecting
        ? { label: t("apps.share.generatePreview"), disabled: true, run: recheck }
        : { label: t("apps.share.recheck"), disabled: false, run: recheck };

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
        {compatibility ? (
          <CompatibilityReminder
            failure={compatibility}
            onClose={() => onOpenChange(false)}
            onRetry={() => setCompatibility(null)}
          />
        ) : (
          <>
            <DialogHeader className="mb-5 shrink-0 gap-0 text-left">
              <DialogTitle className="text-xl/7 font-semibold">
                {t("apps.share.title")}
              </DialogTitle>
              <DialogDescription className="mt-3 text-[15px]/[1.4]">
                {t("apps.share.description")}
              </DialogDescription>
            </DialogHeader>
            <AppDialogBody className="flex flex-col gap-4">
              {detecting ? (
                <p
                  className="flex items-center gap-2.5 text-[15px]/[1.4] text-muted-foreground"
                  role="status"
                >
                  <Spinner className="size-4" />
                  {t("apps.share.detecting")}
                </p>
              ) : status && !ready ? (
                <div className="flex flex-col gap-3 rounded-lg border p-4">
                  <p className="text-[15px]/[1.4]">{status.message}</p>
                  {/* 命令要看起来像命令。裸 <code> 没底色没边框，混在正文里
                      读起来像一句话，而它是要照抄进终端的东西。 */}
                  <div className="flex flex-col gap-1.5">
                    <code className="rounded-md bg-muted px-2.5 py-2 font-mono text-[13px] select-all">
                      brew install gh
                    </code>
                    <code className="rounded-md bg-muted px-2.5 py-2 font-mono text-[13px] select-all">
                      gh auth login
                    </code>
                  </div>
                </div>
              ) : preview ? (
                <div className="flex flex-col gap-3 text-[15px]/[1.4]">
                  {preview.readmePlaceholder && (
                    <p className="rounded-lg bg-amber-500/10 p-3 text-[13px]/[1.45] text-amber-800 dark:text-amber-300">
                      {t("apps.share.readmePlaceholder")}
                    </p>
                  )}
                  <p>{preview.diffSummary}</p>
                  <p className="text-[13px]/[1.45] text-muted-foreground">
                    {t("apps.share.fileSummary", {
                      files: preview.files.length,
                      rows: preview.rowCount,
                    })}
                  </p>
                  <SlimScroller asChild>
                    <ul className="max-h-40 overflow-y-auto rounded-md border p-2 font-mono text-xs">
                      {preview.files.map((file) => (
                        <li key={file.path}>{file.path} · {file.bytes} B</li>
                      ))}
                    </ul>
                  </SlimScroller>
                  {preview.sampleRows.length > 0 && (
                    <SlimScroller asChild>
                      <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(preview.sampleRows, null, 2)}
                      </pre>
                    </SlimScroller>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* ── 后果贴回选项本体 ─────────────────────────────────
                      「全部真实数据」的后果是把整个 Base 推上一个默认公开的
                      仓库。它此前是一个原生 <select> 里的第三行：绕过本包的
                      Select、比旁边的输入框高 8px，而且没有任何地方写着选它
                      会发生什么。三行选项各自带上自己的代价，读者才有判据。 */}
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-[13px]/[1.45] font-medium text-muted-foreground">
                      {t("apps.share.data")}
                    </legend>
                    <div className="grid gap-2" role="radiogroup">
                      {DATA_MODES.map((candidate) => (
                        <DialogChoice
                          aria-checked={mode === candidate.mode}
                          detail={t(candidate.detailKey)}
                          key={candidate.mode}
                          onClick={() => setMode(candidate.mode)}
                          role="radio"
                          selected={mode === candidate.mode}
                          title={t(candidate.titleKey)}
                          tone={candidate.tone}
                        />
                      ))}
                    </div>
                  </fieldset>
                  {isReshare ? (
                    <div className="rounded-lg border p-3">
                      <p className="text-[13px]/[1.45] font-medium text-muted-foreground">
                        {t("apps.share.fixedTarget")}
                      </p>
                      <p className="mt-1 text-[15px]/[1.4] break-all">
                        {record.publishedRepoUrl}
                      </p>
                    </div>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1.5">
                        <span className="text-[13px]/[1.45] font-medium text-muted-foreground">
                          {t("apps.share.repositoryName")}
                        </span>
                        <Input
                          size="lg"
                          onChange={(event) => setRepoName(event.target.value)}
                          value={repoName}
                        />
                      </label>
                      <label className="flex items-center gap-2.5 text-[15px]/[1.4]">
                        <input
                          checked={visibility === "private"}
                          className="size-4"
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
              {error && (
                <p className="text-[13px]/[1.45] text-destructive" role="alert">
                  {error}
                </p>
              )}
            </AppDialogBody>
            <DialogFooter className="mt-5 shrink-0 sm:gap-3">
              <Button
                className="text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => onOpenChange(false)}
                size="pill"
                type="button"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              {preview && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    void discardAppShare(preview.previewId);
                    setPreview(null);
                  }}
                  size="pill"
                  variant="outline"
                >
                  {t("common.back")}
                </Button>
              )}
              <Button
                disabled={primary.disabled}
                onClick={primary.run}
                size="pill"
              >
                {busy && <Spinner />}
                {primary.label}
              </Button>
            </DialogFooter>
          </>
        )}
      </AppDialogContent>
    </Dialog>
  );
}

/* 键写全，不用模板拼。拼出来的键 grep 不到：删一条文案或改一次命名时，
   没有任何搜索能告诉你它还在被用，而 i18n 的静态闸口也看不见它。 */
const DATA_MODES: readonly {
  mode: ShareDataMode;
  titleKey: string;
  detailKey: string;
  tone: "default" | "danger";
}[] = [
  {
    mode: "sample",
    titleKey: "apps.share.sample",
    detailKey: "apps.share.sampleDetail",
    tone: "default",
  },
  {
    mode: "schema",
    titleKey: "apps.share.schema",
    detailKey: "apps.share.schemaDetail",
    tone: "default",
  },
  {
    mode: "full",
    titleKey: "apps.share.full",
    detailKey: "apps.share.fullDetail",
    tone: "danger",
  },
];

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
