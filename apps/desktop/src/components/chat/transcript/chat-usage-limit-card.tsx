/**
 * [INPUT]: Depends on React state/effect, shared AgentFailureNotice, UI Button, current Intl locale, structured ProductFailure/UsageLimitInfo, and five-language failure copy
 * [OUTPUT]: Provides RemainingDuration projection and UsageLimitCard with human-first rate/quota copy, folded diagnostics, reset time, duration, known window, and retry action
 * [POS]: Usage-limit recovery surface in chat/transcript; wire DTOs provide machine facts while this renderer owns all presentation copy
 */

import { useEffect, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { UsageLimitInfo } from "../../../../shared/agent-ipc";
import { intlLocale } from "@/lib/i18n-locale";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { ProductFailure } from "../../../../shared/product-failure";

// ─── 只展示拿得到的事实 ───
// 三家后端给的信息量天差地别：Claude 有结构化 resetsAt + 窗口类型，
// Codex 只有一句自然语言，Kimi 是服务商短时限流。卡片不为对齐视觉而编造字段——
// 拿不到就整行不出现，这比填一个猜的时间诚实得多。

/** 恢复时刻的本地表述：带时区名，避免用户在跨时区场景误读 */
function resetAtParts(resetsAt: number) {
  const date = new Date(resetsAt);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    date: date.toLocaleString(intlLocale(), {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    zone,
  };
}

export type RemainingDuration =
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number }
  | { kind: "hours-minutes"; hours: number; minutes: number };

/** 剩余时长是结构化事实；已过点返回 undefined，文案由当前语言目录决定。 */
export function remainingDuration(
  resetsAt: number,
  now: number
): RemainingDuration | undefined {
  const minutes = Math.ceil((resetsAt - now) / 60_000);
  if (minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return { kind: "minutes", minutes: rest };
  return rest
    ? { kind: "hours-minutes", hours, minutes: rest }
    : { kind: "hours", hours };
}

/** 每分钟重算一次剩余时长——秒级刷新对"约 X 分钟"毫无意义，只是白烧帧 */
function useMinuteClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="shrink-0 font-medium">{label}</span>
      <span className="min-w-0 text-muted-foreground">{value}</span>
    </div>
  );
}

export function UsageLimitCard({
  backendDisplayName,
  limit,
  message,
  onRetry,
  retryDisabled,
  failure,
  backendId,
}: {
  backendDisplayName: string;
  limit: UsageLimitInfo;
  message: string;
  onRetry: () => void;
  retryDisabled?: boolean;
  failure?: ProductFailure;
  backendId?: AgentBackendId;
}) {
  const { t } = useAppTranslation();
  const now = useMinuteClock(limit.resetsAt !== undefined);
  const remainingDurationValue =
    limit.resetsAt === undefined
      ? undefined
      : remainingDuration(limit.resetsAt, now);
  const remaining = !remainingDurationValue
    ? undefined
    : remainingDurationValue.kind === "minutes"
      ? t("chat.usageLimit.aboutMinutes", remainingDurationValue)
      : remainingDurationValue.kind === "hours"
        ? t("chat.usageLimit.aboutHours", remainingDurationValue)
        : t("chat.usageLimit.aboutHoursMinutes", remainingDurationValue);
  // provider 是服务商短时限流，没有"额度周期"可言；unknown 是确认限流但窗口未知。
  // 两者都不该冒充订阅周期，故这一行只在窗口确凿时成立。
  const windowLabel =
    limit.window === "five-hour"
      ? t("chat.usageLimit.window.fiveHour")
      : limit.window === "weekly"
        ? t("chat.usageLimit.window.weekly")
        : undefined;
  const resetAt =
    limit.resetsAt === undefined ? undefined : resetAtParts(limit.resetsAt);
  const facts = (limit.resetsAt !== undefined || windowLabel) && (
    <div className="mt-3 flex flex-col gap-1">
      {limit.resetsAt !== undefined && (
        <DetailRow
          label={t("chat.usageLimit.resetTime")}
          value={
            remaining
              ? `${t("chat.usageLimit.resetAt", resetAt)} ${remaining}`
              : t("chat.usageLimit.resetAt", resetAt)
          }
        />
      )}
      {windowLabel && (
        <DetailRow
          label={t("chat.usageLimit.usageWindow")}
          value={windowLabel}
        />
      )}
    </div>
  );
  const retry = (
    <div className="mt-4 flex justify-end">
      <Button
        disabled={retryDisabled}
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        <RotateCcwIcon className="size-3.5" />
        {t("chat.usageLimit.retry")}
      </Button>
    </div>
  );
  if (failure) {
    return (
      <AgentFailureNotice
        backend={backendDisplayName}
        backendId={backendId}
        failure={failure}
        tone="warning"
      >
        {facts}
        {retry}
      </AgentFailureNotice>
    );
  }
  return (
    <div className="w-full min-w-0 rounded-xl border bg-muted/40 p-4">
      <div className="font-medium text-base">
        {t("chat.usageLimit.unavailable", { backend: backendDisplayName })}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-sm">
        {message}
      </p>
      {facts}
      {retry}
    </div>
  );
}
