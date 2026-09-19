"use client";

/**
 * [INPUT]: Depends on React, I18n, preflight source counts, shared history-import agreement, HistoryProvider, lib/agent-backends AgentBackendIcon, and dialog/button primitives
 * [OUTPUT]: Provides ProjectImportDialog for found history or unavailable scans, with source counts, explicit add-without-history/import actions, and optional Memory Grant preview→commit
 * [POS]: The explicit user authorization surface of sidebar/project/import; history/memory stay off by default and are chosen per-button, never a standing checkbox; Grant is confirmed in the second step and delivery runs on the main backstage pump
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { HISTORY_SOURCE_KINDS, type HistoryMemoryEligibility, type HistoryMemoryPreview, type HistorySourceCount, type HistorySourceKind, type PreparedProjectHistoryImport } from "../../../../../shared/history-import-ipc";
import type { Project } from "../../../../../shared/projects-ipc";
import { useHistory } from "@/components/providers/history/history-provider";
import { AgentBackendIcon } from "@/lib/agent-backends";
import { historyMemoryEligibility } from "@/lib/history/client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@ai-chat/ui/components/ui/dialog";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";

const SOURCE_LABEL: Record<HistorySourceKind, string> = { claude: "Claude Code", codex: "Codex", kimi: "Kimi CLI", opencode: "OpenCode" };

/* 可见标题说明导入动作；文件夹名称只补充到读屏标题，沿用上一步的选择语境。 */
function leafName(root: string) {
  const trimmed = root.replace(/\/+$/, "") || "/";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/* ============================================================
 * 证据行：一条平铺列表，不再裹卡片、不再做 badge。
 *
 * 扫描由 Provider 在弹窗之前完成，这里只消费结果，不重复发起磁盘读取。
 * null = 没有来源回执，installed&count>0 = 有，
 * installed&count===0 = 无聊天记录，!installed = 未安装。
 * 品牌标记不随存量变淡：logo 说的是「它是谁」，不是「它有多少」。
 * ============================================================ */
function SourceRow({ kind, count }: {
  kind: HistorySourceKind;
  count: HistorySourceCount | null;
}) {
  const { t } = useAppTranslation();
  const found = count ? count.installed && count.count > 0 : false;
  return (
    <li className="flex items-center gap-2.5 py-2.5">
      <AgentBackendIcon backend={kind} className="size-4" />
      <span className={cn("text-xs", found ? "font-medium" : "text-muted-foreground")}>
        {SOURCE_LABEL[kind]}
      </span>
      <span className={cn("ml-auto text-xs tabular-nums", !found && "text-muted-foreground")}>
        {count === null
          ? "—"
          : !count.installed
            ? t("history.notInstalled")
            : count.count > 0
              ? t("history.sourceCount", { count: count.count })
              : t("history.sourceNone")}
      </span>
    </li>
  );
}

/* ============================================================
 * 第二步：Grant 确认。三条不可撤销的后果留在这里，而非第一步——把后果提前
 * 讲完，反而让真正签字的这一步显得轻。（保持原样，不在本次版式改造范围内。）
 * ============================================================ */
function MemoryDelta({ preview }: { preview: HistoryMemoryPreview }) {
  const { t, i18n } = useAppTranslation();
  const formatDate = (value: number | null) => value === null
    ? "—"
    : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value);
  return (
    <div className="space-y-3 text-muted-foreground">
      <div className="grid grid-cols-[1fr_1.35fr_1.75fr] divide-x divide-border overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <Fact label={t("history.previewChats")} value={String(preview.chats)} />
        <Fact label={t("history.previewTurns")} value={String(preview.turns)} />
        <Fact label={t("history.previewRange")} value={`${formatDate(preview.from)} – ${formatDate(preview.to)}`} />
      </div>
      <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-[17px] marker:text-muted-foreground/50">
        <li>{t("history.settingsPreviewDisclosure")}</li>
        <li>{t("history.memoryRetained")}</li>
        {preview.sharingMode === "personal" && <li>{t("history.personalCrossProject")}</li>}
      </ul>
      <div>
        <span className="block text-[11px] leading-[15px]">{t("history.snapshotDigest")}</span>
        <code className="mt-1 block break-all rounded-md bg-muted px-2.5 py-2 font-mono text-[10px] leading-[15px]">
          {preview.digest}
        </code>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <span className="block font-medium text-foreground text-sm tabular-nums">{value}</span>
      <span className="mt-px block whitespace-nowrap text-[11px] leading-[15px]">{label}</span>
    </div>
  );
}

/** 挂载方以 key=token 重挂重置表单；本组件不承担跨 prepared 的状态清理。 */
export function ProjectImportDialog({ prepared, counts, onComplete }: {
  prepared: PreparedProjectHistoryImport;
  counts: HistorySourceCount[];
  onComplete(project: Project | null): void;
}) {
  const { t } = useAppTranslation();
  const { commitProject, commitMemory } = useHistory();
  /* 两颗按钮决定是否导入聊天记录；记忆导入是独立的可选项，
     只在合格时出现，且只对「Import history」这条路生效。 */
  const [importMemory, setImportMemory] = useState(false);
  const [pending, setPending] = useState<"skip" | "add" | "confirm" | null>(null);
  const [eligibility, setEligibility] = useState<HistoryMemoryEligibility | null>(null);
  const [preview, setPreview] = useState<HistoryMemoryPreview | null>(null);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const busy = pending !== null;

  useEffect(() => {
    let stale = false;
    void historyMemoryEligibility({ surface: "project" })
      .then((next) => { if (!stale) setEligibility(next); })
      .catch(() => { if (!stale) setEligibility(null); });
    return () => { stale = true; };
  }, [prepared.token]);

  const commit = async (importHistory: boolean) => {
    if (busy) return;
    setPending(importHistory ? "add" : "skip");
    setError("");
    try {
      const result = await commitProject({
        token: prepared.token,
        importHistory,
        previewMemory: importHistory && importMemory,
      });
      setCreatedProject(result.project);
      if (result.memoryPreview) setPreview(result.memoryPreview);
      else onComplete(result.project);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  const confirmMemory = async () => {
    if (!preview || !createdProject || busy) return;
    setPending("confirm");
    setError("");
    try {
      await commitMemory(preview.snapshotId, preview.digest);
      onComplete(createdProject);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  /* 完整的零记录结果已直接添加项目；到达此处的零记录意味着扫描未能确认。 */
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  const description = total > 0
    ? t("history.projectFoundDescription", { count: total })
    : t("history.projectUnavailableDescription");

  /* 记忆合格与否不看待定的历史选择（无常驻开关可看），只看后端合格性；
     勾选它就是在说「走 Import history 这条路时，顺带导入记忆」。 */
  const memoryEnabled = Boolean(eligibility?.enabled);
  const memoryHint = () => {
    if (!eligibility?.enabled) {
      return t(eligibility?.reason === "chat-mode" ? "history.memoryChatMode" : "history.importMemoryDetail");
    }
    return t("history.memoryDestination", { scope: t(`memory.sharing.mode.${eligibility.sharingMode}`) });
  };

  const leaf = leafName(prepared.canonicalRoot);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onComplete(createdProject);
      }}
    >
      <DialogContent>
        {preview ? (
          <>
            <DialogHeader className="pr-6">
              <DialogTitle>{t("history.projectMemoryPreviewTitle")}</DialogTitle>
              <DialogDescription>{t("history.projectMemoryNeedsConfirmation")}</DialogDescription>
            </DialogHeader>
            <MemoryDelta preview={preview} />
          </>
        ) : (
          <>
            <div className="flex flex-col">
              <DialogTitle className="pr-6 font-medium text-sm leading-snug">
                {t("history.projectImportTitle")}
                <span className="sr-only">{` — ${leaf}`}</span>
              </DialogTitle>
              <DialogDescription className="mt-1 pr-6 text-[11px] leading-[16px]">{description}</DialogDescription>
              <ul className="mt-3 divide-y divide-border">
                {HISTORY_SOURCE_KINDS.map((kind) => (
                  <SourceRow
                    count={counts.find((item) => item.sourceKind === kind) ?? null}
                    key={kind}
                    kind={kind}
                  />
                ))}
              </ul>
              {eligibility?.visible && (
                <label className={cn(
                  "flex min-h-11 items-start gap-2.5 border-t border-border py-2.5",
                  memoryEnabled ? "cursor-pointer" : "cursor-not-allowed"
                )}>
                  <input
                    checked={importMemory}
                    className="mt-0.5 size-4 shrink-0 accent-foreground"
                    disabled={!memoryEnabled}
                    onChange={(event) => setImportMemory(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <span className={cn("block text-xs leading-[18px]", memoryEnabled ? "font-medium" : "text-muted-foreground")}>
                      {t("history.importMemory")}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground leading-[17px]">{memoryHint()}</span>
                  </span>
                </label>
              )}
            </div>
          </>
        )}
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs ring-1 ring-destructive/20" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="flex-row justify-end gap-3">
          {preview ? (
            <>
              <Button
                className="text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => onComplete(createdProject)}
                size="pill"
                variant="ghost"
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={busy} onClick={() => void confirmMemory()} size="pill">
                {pending === "confirm" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t("history.settingsConfirm")}
              </Button>
            </>
          ) : (
            <>
              {/* 两颗都是「添加」，只是带不带历史；取消交给右上角的 X。 */}
              <Button
                className="text-muted-foreground hover:text-foreground"
                disabled={busy}
                onClick={() => void commit(false)}
                size="pill"
                variant="ghost"
              >
                {pending === "skip" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t("history.addWithoutHistory")}
              </Button>
              <Button disabled={busy} onClick={() => void commit(true)} size="pill">
                {pending === "add" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t("history.addWithHistory")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
