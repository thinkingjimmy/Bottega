/**
 * [INPUT]: Depends on ui Button, cn, lucide icons, Chat composer i18n, backend display names and shared AgentApprovalRequest/Decision
 * [OUTPUT]: Provides localized ChatApprovalCard; backend choices stay verbatim while fallback decisions, request titles, metadata, and details use the catalog
 * [POS]: Composer decision surface for one pending approval; Plan review replaces the editor slot while ordinary approvals sit above it
 */

import { ArrowRightIcon, LightbulbIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../../../../shared/agent-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/* ── 决策渲染归一 ──────────────────────────────────────────────
 * ACP 后端给 choices 时用后端文案，否则合成同形的默认三选项。
 * 归一后每种形态的按钮只有一条渲染路径。
 * ────────────────────────────────────────────────────────── */
type DecisionButton = {
  decision: AgentApprovalDecision;
  label: string;
  tone: "primary" | "secondary" | "danger";
};

const TONE_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
} as const;

function fallbackChoices(
  approval: AgentApprovalRequest,
  planReview: boolean,
  t: (key: string) => string
): DecisionButton[] {
  return [
    {
      decision: "decline",
      label: t(
        planReview
          ? "chat.composer.approval.requestChanges"
          : "chat.composer.approval.decline"
      ),
      tone: "secondary",
    },
    ...(approval.canAcceptForSession
      ? [{
          decision: "accept-for-session",
          label: t("chat.composer.approval.allowSession"),
          tone: "secondary",
        } as const]
      : []),
    {
      decision: "accept",
      label: t(
        planReview
          ? "chat.composer.approval.approvePlan"
          : "chat.composer.approval.allowOnce"
      ),
      tone: "primary",
    },
  ];
}

/* ── 详情去重 ─────────────────────────────────────────────────
 * ACP 的 rawInput 摘要天然含 `command: <原样命令>` 一行，与上方命令块
 * 逐字重复。按行剔除"只是把命令再说一遍"的那些行；剔空即整块不渲染。
 * 判据落在数据上，JSX 因此仍只有一条渲染路径，不必为后端各自开分支。
 * ────────────────────────────────────────────────────────── */
function detailBeyondCommand(reason: string, command?: string) {
  const echo = command?.trim();
  if (!echo) return reason.trim();
  return reason
    .split("\n")
    .filter((line) => {
      const text = line.trim();
      return text !== echo && text.replace(/^[\w.-]+:\s*/, "") !== echo;
    })
    .join("\n")
    .trim();
}

/* ── 元信息行 ─────────────────────────────────────────────────
 * label 定宽对齐，value 等宽字体单行截断，title 承载完整值。
 * ────────────────────────────────────────────────────────── */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={value}>
        {value}
      </span>
    </div>
  );
}

/* ── plan-review 决策行 ───────────────────────────────────────
 * 计划正文已作为 plan 块显示在对话中，这里只剩决策本身：
 * 编号行沿用 Plan 完成态（ChatPlanDecision）的视觉语言，
 * tone 落在文字色上——danger 只是红字，不是红底恐吓。
 * ────────────────────────────────────────────────────────── */
function PlanChoiceRow({
  choice,
  index,
  busy,
  onDecision,
}: {
  choice: DecisionButton;
  index: number;
  busy: boolean;
  onDecision: (decision: AgentApprovalDecision) => void;
}) {
  return (
    <button
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        choice.tone === "danger" && "text-destructive"
      )}
      disabled={busy}
      onClick={() => onDecision(choice.decision)}
      type="button"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-muted-foreground text-xs tabular-nums">
        {index + 1}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1",
          choice.tone === "primary" && "font-medium"
        )}
      >
        {choice.label}
      </span>
      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" />
    </button>
  );
}

export function ChatApprovalCard({
  approval,
  backendDisplayName,
  busy,
  error,
  onDecision,
}: {
  approval: AgentApprovalRequest;
  backendDisplayName: string;
  busy: boolean;
  error?: string;
  onDecision: (decision: AgentApprovalDecision) => void;
}) {
  const { t } = useAppTranslation();
  const planReview = approval.purpose === "plan-review";
  const choices: DecisionButton[] = approval.choices?.length
    ? approval.choices
    : fallbackChoices(approval, planReview, t);
  const title = planReview
    ? t("chat.composer.approval.planTitle")
    : approval.kind === "command"
      ? t("chat.composer.approval.commandTitle")
      : approval.kind === "file-change"
        ? t("chat.composer.approval.fileChangeTitle")
        : t("chat.composer.approval.permissionTitle");
  const detail = detailBeyondCommand(approval.reason ?? "", approval.command);

  return (
    <section
      className={cn(
        "rounded-2xl border bg-background p-3",
        // plan-review 占据输入框槽位（间距归容器）；普通审批叠在输入框上方，自带下距
        !planReview && "mb-3"
      )}
    >
      {/* 标题区：品牌 eyebrow + 决策标题；Plan 用灯泡承接对话里的 plan 块，危险语义只落在图标 */}
      <div className="flex min-h-8 items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full",
            planReview
              ? "bg-muted text-muted-foreground"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-500"
          )}
        >
          {planReview ? (
            <LightbulbIcon className="size-4" />
          ) : (
            <ShieldAlertIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] text-muted-foreground">
            {backendDisplayName}
            {approval.agentName && ` · ${approval.agentName}`}
          </p>
          <h2 className="font-medium text-sm leading-5">{title}</h2>
        </div>
      </div>

      {/* 命令块：w-fit 让工具名收成胶囊、长命令自然铺满，无需分支 */}
      {approval.command && (
        <SlimScroller asChild>
          <pre className="mt-2.5 max-h-28 w-fit max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs leading-5">
            {approval.command}
          </pre>
        </SlimScroller>
      )}

      {(approval.cwd || approval.networkHost) && (
        <div className="mt-2 space-y-0.5">
          {approval.cwd && (
            <MetaRow
              label={t("chat.composer.approval.location")}
              value={approval.cwd}
            />
          )}
          {approval.networkHost && (
            <MetaRow
              label={t("chat.composer.approval.network")}
              value={approval.networkHost}
            />
          )}
        </div>
      )}

      {/* plan-review 正常已无 reason（计划走 plan 块）；这里只兜底
          拿不到计划正文的后端请求，如 Kimi 多方案选择 */}
      {detail && (
        <div className="mt-2 border-t pt-2">
          <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
            {planReview
              ? t("chat.composer.approval.plan")
              : t("chat.composer.approval.details")}
          </p>
          <SlimScroller asChild>
            <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5">
              {detail}
            </p>
          </SlimScroller>
        </div>
      )}

      {error && <p className="mt-2 text-destructive text-xs">{error}</p>}

      {planReview ? (
        <div className="mt-3 flex flex-col gap-1">
          {choices.map((choice, index) => (
            <PlanChoiceRow
              busy={busy}
              choice={choice}
              index={index}
              key={choice.decision}
              onDecision={onDecision}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {choices.map((choice) => (
            <Button
              className="h-auto min-h-8 max-w-full whitespace-normal rounded-full py-1.5 text-left"
              disabled={busy}
              key={choice.decision}
              onClick={() => onDecision(choice.decision)}
              size="lg"
              variant={TONE_VARIANT[choice.tone]}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}
