/**
 * [INPUT]: Depends on React, lucide status/chevron/copy icons, UI Button, and caller-projected product copy
 * [OUTPUT]: Provides a reusable human-first failure alert on a neutral surface, with tone carried by the icon alone and a default-closed diagnostic disclosure whose icon-only copy action stays inside the diagnostic row
 * [POS]: Neutral renderer presentation primitive wrapped by domain-specific Agent and Chat-storage notices
 */

import { useState, type ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";

export type ProductFailureNoticeCopy = Readonly<{
  title: string;
  explanation: string;
  resolution: string;
  diagnostic?: string;
}>;

export type ProductFailureNoticeLabels = Readonly<{
  technicalDetails: string;
  copyDetails: string;
  copiedDetails: string;
}>;

/* ── 反引号 → 行内代码 ────────────────────────────────────────────
   `kimi login` 这类命令是整条消息里唯一要用户动手的东西。以纯文本渲染
   时，那对反引号被当字面量画了出来，命令本身反倒和周围灰字融成一片。
   只认成对反引号，落单的原样留着——不为一个 chip 引进 Markdown 依赖。
   标题不走这条路：它是标题，命令属于正文。 */
function withCodeSpans(text: string): ReactNode {
  const parts = text.split("`");
  if (parts.length % 2 === 0) return text;
  return parts.map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <code
        className="rounded-sm border bg-background px-1 py-px font-mono text-foreground text-xs"
        key={index}
      >
        {part}
      </code>
    )
  );
}

export function ProductFailureNotice({
  copy,
  labels,
  tone = "danger",
  compact = false,
  children,
}: {
  copy: ProductFailureNoticeCopy;
  labels: ProductFailureNoticeLabels;
  tone?: "danger" | "warning";
  compact?: boolean;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const warning = tone === "warning";
  const copyDiagnostic = async () => {
    if (!copy.diagnostic || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(copy.diagnostic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard denial leaves the diagnostic selectable without adding noise.
    }
  };

  /* ── 中性表面：语气只由图标承担 ──────────────────────────────────
     整片 destructive 底 + 红边 + 红色粗体标题，是把「登录过期」画成了
     灾难现场；而它在 transcript 里紧挨着普通消息，块面一带色就成了全屏
     最响的东西。外壳退回 usage-limit unavailable 卡的同款中性形制，红色
     收进那个 16px 三角——语义不丢，块面消失。 */
  return (
    <div className={cn(
      "w-full min-w-0 max-w-full overflow-hidden rounded-lg border bg-muted/40",
      compact ? "px-3 py-2.5" : "px-4 py-3"
    )}>
      <div className="flex gap-2.5" role="alert" aria-atomic="true">
        <TriangleAlertIcon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            warning ? "text-amber-700 dark:text-amber-400" : "text-destructive"
          )}
        />
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="text-pretty font-medium">{copy.title}</p>
          {copy.explanation && (
            <p className="text-muted-foreground">{withCodeSpans(copy.explanation)}</p>
          )}
          {copy.resolution && (
            <p className="text-muted-foreground">{withCodeSpans(copy.resolution)}</p>
          )}
          {children}
        </div>
      </div>
      {copy.diagnostic && (
        /* summary 用 flex 会连原生小三角一起吃掉（Chromium），故自带 chevron：
           少了它，那一行就是一段没有任何可点暗示的灰字。 */
        <details className="group mt-2.5 text-xs">
          <summary
            className={cn(
              "relative flex w-fit cursor-pointer touch-manipulation select-none items-center gap-1 rounded-sm py-0.5",
              "text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              /* 横向借 6px：这一行左边就是卡片内边距，右边是空白，借多了无益 */
              "touch-target-44 [--touch-target-inset:-6px]"
            )}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {labels.technicalDetails}
          </summary>
          <div className="mt-2 flex min-w-0 items-start gap-2 rounded-md border bg-background p-2">
            <pre className="max-h-40 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-0.5 font-mono text-[11px] text-muted-foreground">
              {copy.diagnostic}
            </pre>
            <Button
              aria-label={copied ? labels.copiedDetails : labels.copyDetails}
              className="relative touch-manipulation touch-target-44 [--touch-target-inset:-8px]"
              onClick={() => void copyDiagnostic()}
              size="icon-sm"
              title={copied ? labels.copiedDetails : labels.copyDetails}
              type="button"
              variant="outline"
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
