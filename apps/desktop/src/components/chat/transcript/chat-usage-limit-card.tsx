/**
 * [INPUT]: Depends on React state/effect, ui Button, lucide icon, renderer, current Intl locale, shared UsageLimitInfo and window word list
 * [OUTPUT]: Provides UsageLimitCard ((Refresh-tested card: title, description, recovery time/Refresh-cycle as feasible)
 * [POS]: The limit-flow filter of chat/transcript failed, replacing the red box with pure text; usage-limit is selected by ChatTurn in failureKind==="usage-limit"
 */

import { useEffect, useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  USAGE_LIMIT_WINDOW_LABEL,
  type UsageLimitInfo,
} from "../../../../shared/agent-ipc";
import { intlLocale } from "@/lib/i18n-locale";

// ─── 只展示拿得到的事实 ───
// 三家后端给的信息量天差地别：Claude 有结构化 resetsAt + 窗口类型，
// Codex 只有一句自然语言，Kimi 是服务商短时限流。卡片不为对齐视觉而编造字段——
// 拿不到就整行不出现，这比填一个猜的时间诚实得多。

/** 恢复时刻的本地表述：带时区名，避免用户在跨时区场景误读 */
function formatResetAt(resetsAt: number) {
  const date = new Date(resetsAt);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const label = date.toLocaleString(intlLocale(), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${label}（${zone}）`;
}

/** 剩余时长；已过点即返回 undefined，让"约 X"整段消失而非显示负数 */
function formatRemaining(resetsAt: number, now: number) {
  const minutes = Math.ceil((resetsAt - now) / 60_000);
  if (minutes <= 0) return undefined;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `约 ${rest} 分钟`;
  return rest ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`;
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
}: {
  backendDisplayName: string;
  limit: UsageLimitInfo;
  message: string;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  const now = useMinuteClock(limit.resetsAt !== undefined);
  const remaining =
    limit.resetsAt === undefined
      ? undefined
      : formatRemaining(limit.resetsAt, now);
  // provider 是服务商短时限流，没有"额度周期"可言；unknown 是确认限流但窗口未知。
  // 两者都不该冒充订阅周期，故这一行只在窗口确凿时成立。
  const windowLabel =
    limit.window === "five-hour" || limit.window === "weekly"
      ? USAGE_LIMIT_WINDOW_LABEL[limit.window]
      : undefined;
  return (
    <div className="w-full min-w-0 rounded-xl border bg-muted/40 p-4">
      <div className="font-medium text-base">
        {backendDisplayName} 暂时不可用
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-sm">
        {message}
      </p>
      {(limit.resetsAt !== undefined || windowLabel) && (
        <div className="mt-3 flex flex-col gap-1">
          {limit.resetsAt !== undefined && (
            <DetailRow
              label="恢复时间"
              value={
                remaining
                  ? `${formatResetAt(limit.resetsAt)} ${remaining}`
                  : formatResetAt(limit.resetsAt)
              }
            />
          )}
          {windowLabel && <DetailRow label="额度周期" value={windowLabel} />}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button
          disabled={retryDisabled}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcwIcon className="size-3.5" />
          立即重试
        </Button>
      </div>
    </div>
  );
}
