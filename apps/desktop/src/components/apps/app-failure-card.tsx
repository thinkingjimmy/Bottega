/**
 * [INPUT]: Depends on app-state failure title/aftermath maps and retry titleKey/detailKey pairs, Apps i18n, repair eligibility, the shared DialogChoice option row, and UI card/button/tooltip primitives
 * [OUTPUT]: Provides AppFailureCard: the verdict, the answers that carry their own consequences, and a full-bleed machine band holding the raw error, its phase, copy, and the full log
 * [POS]: Apps failure surface consumed by AppDetailView; durable Base imports expose only continue or cancel
 */

import { useId, useState } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon, ScrollTextIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DialogChoice } from "@ai-chat/ui/components/ui/app-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ai-chat/ui/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { cn } from "@ai-chat/ui/lib/utils";
import { repairSite, type AppRecord } from "../../../shared/apps-ipc";
import {
  failureAftermathKey,
  failurePhaseTitleKey,
  failureRetryChoiceKey,
  failureRetryKind,
  failureTitleKey,
  isFailedState,
  isPendingBaseImport,
  pendingImportAftermathKey,
  repairDetailKey,
  retryLabelKey,
} from "./app-state";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type AppFailureCardProps = {
  record: AppRecord;
  onRetry: () => void;
  onCancel: () => void;
  onRepair: () => void;
  onShowLog: () => void;
};

/* ── 一张卡两种形态，机器区永远在底槽 ────────────────────────────────
 * 沿用删除弹窗那次的裁决。失败几乎总是选择题——重装还是就地修，继续还是
 * 放弃——于是答案用两行的选项行，每个答案自带它的代价；一排平权按钮只能
 * 承载动词，选了会怎样只能靠猜。
 *
 * 唯一的例外是 delete-failed：它只有一条路。只有一条路就不该摆成选择题，
 * 它退回确认形态的一颗主按钮。形态差异本身就在说「这里没得选」。
 *
 * 而「查看完整日志」从来不是答案，是诊断工具；它从前穿着和答案一样的
 * outline 外套站在同一排里。现在它和「复制」一起退到底槽，跟错误信息
 * 待在一起——工具应当挨着它作用的那个东西。
 * ────────────────────────────────────────────────────────────────── */
export function AppFailureCard({
  record,
  onRetry,
  onCancel,
  onRepair,
  onShowLog,
}: AppFailureCardProps) {
  const { t } = useAppTranslation();
  if (!isFailedState(record.state)) return null;

  const pendingImport = isPendingBaseImport(record);
  const site = pendingImport ? null : repairSite(record);
  const retry = failureRetryChoiceKey[failureRetryKind(record)];
  const soleAnswer = record.state === "delete-failed";

  return (
    <div className="flex size-full items-center justify-center p-8">
      {/* pb-0 而非让底槽用负 margin 去抵掉它：抵消要求这里的算术与 Card 的
          内边距永远一致，而算错了没有任何东西会报错——只会剩下一条谁都说不清
          来路的缝。把那段内边距直接撤掉，底槽自然落在卡片下沿。 */}
      <Card className="max-w-lg pb-0">
        <CardHeader>
          {/* 标题说哪一步没过；没有 lastError 时才退回状态机的说法。 */}
          <CardTitle>
            {t(
              record.lastError
                ? failurePhaseTitleKey[record.lastError.phase]
                : failureTitleKey[record.state]
            )}
          </CardTitle>
          <CardDescription>
            {t(
              pendingImport
                ? pendingImportAftermathKey
                : failureAftermathKey[record.state]
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {soleAnswer ? (
            <div className="flex justify-end">
              <Button onClick={onRetry}>{t(retryLabelKey[record.state])}</Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <DialogChoice
                size="sm"
                badge={t("apps.failure.recommended")}
                title={t(retry.titleKey)}
                detail={t(retry.detailKey)}
                onClick={onRetry}
              />
              {pendingImport && (
                <DialogChoice
                  size="sm"
                  tone="danger"
                  title={t("apps.failure.choice.cancel.title")}
                  detail={t("apps.failure.choice.cancel.detail")}
                  onClick={onCancel}
                />
              )}
              {site && (
                <DialogChoice
                  size="sm"
                  title={t("apps.failure.choice.repair.title")}
                  detail={t(repairDetailKey[site])}
                  onClick={onRepair}
                />
              )}
            </div>
          )}
        </CardContent>
        <FailureBand error={record.lastError} onShowLog={onShowLog} />
      </Card>
    </div>
  );
}

/* ── 底槽：证据不是答案 ─────────────────────────────────────────────
 * 从前这段是卡片正文里一段无上限的红字。两件事都错了：红是留给「危险的
 * 答案」的，一整段堆栈标红只会让红贬值；而无上限意味着一段 npm 堆栈会把
 * 卡片撑破，或者被 Card 的 overflow-hidden 悄悄切掉。
 *
 * 它先被改成一个描边圆角盒，但那和选项行同形同重，于是被读成第三个答案。
 * 现在它满出血成为卡片底盘的一部分——像状态栏：调用方撤掉卡片的下内边距
 * （pb-0），底槽自然落在下沿，圆角交给 Card 已有的 overflow-hidden。
 * Card 原语一行不用动。
 *
 * 收起时仍露出错误的第一行：堆栈的第一行通常正是唯一有用的那行，把它一并
 * 藏起来等于逼每个人都点一次。
 * ────────────────────────────────────────────────────────────────── */
function FailureBand({
  error,
  onShowLog,
}: {
  error: AppRecord["lastError"];
  onShowLog: () => void;
}) {
  const { t } = useAppTranslation();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const traceId = useId();

  const copyMessage = async () => {
    if (!error || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(error.message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard denial leaves the trace selectable without adding noise.
    }
  };

  return (
    <div className="border-t bg-sunken">
      <div className="flex items-center gap-2 py-1 pr-1.5 pl-1">
        {error ? (
          <button
            aria-controls={traceId}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => setExpanded((open) => !open)}
            type="button"
          >
            <ChevronRightIcon
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                expanded && "rotate-90"
              )}
            />
            <span
              className={cn(
                "truncate text-muted-foreground",
                expanded ? "font-medium" : "font-mono text-[11px]"
              )}
            >
              {expanded
                ? t("apps.failure.detail.label")
                : firstLine(error.message)}
            </span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 px-1.5 text-muted-foreground">
            {t("apps.failure.detail.none")}
          </span>
        )}
        {error && (
          /* bg-background 而非 bg-muted：muted 是 0.97，底槽是 0.975，这个 chip
             会在自己的底上彻底消失。让卡片的底色从底槽里透出来，深浅两套配色
             各自成立——浅色下 chip 更亮，深色下更暗，两边都看得见。 */
          <span className="shrink-0 rounded-sm bg-background px-1 font-mono text-[11px] text-muted-foreground">
            {error.phase}
          </span>
        )}
        {/* 两颗工具键成组：gap-0.5 让它们读作一对，而不是两件不相干的事。 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {error && (
            <BandTool
              icon={copied ? <CheckIcon /> : <CopyIcon />}
              label={t(
                copied ? "apps.failure.detail.copied" : "apps.failure.detail.copy"
              )}
              onClick={() => void copyMessage()}
            />
          )}
          <BandTool
            icon={<ScrollTextIcon />}
            label={t("apps.failure.detail.showLog")}
            onClick={onShowLog}
          />
        </div>
      </div>
      {error && expanded && (
        <pre
          className="max-h-40 overflow-auto border-t px-2.5 py-2 font-mono text-[11px] text-foreground break-words whitespace-pre-wrap"
          id={traceId}
        >
          {error.message}
        </pre>
      )}
    </div>
  );
}

/* 图标键没有可读文字：label 一物二用，aria-label 播报，Tooltip 给鼠标与键盘。
   命中区借 ::after 撑到 44px，视觉仍是 24px，不撑开这条 32px 的窄带。 */
function BandTool({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="relative touch-target-44 [--touch-target-inset:-4px]"
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/* 堆栈的第一行是给人看的那行，其余是给机器看的。 */
const firstLine = (message: string) => message.split("\n", 1)[0]?.trim() || message;
