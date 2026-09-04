/**
 * [INPUT]: Depends on shared AgentFailureNotice, the touch-target-44 hit-area utility, ProductFailure/backend identity, UI Button, a Lucide status icon, and the common localized Continue action
 * [OUTPUT]: Provides TurnErrorCard (localized human-first copy, folded diagnostics, optional continuation action) and FailureCard, the transcript-level "this is not an assistant message" card
 * [POS]: Default structured Agent failure card for chat/transcript, selected by ChatTurn when no specialized usage-limit surface applies
 */

import type { ReactNode } from "react";
import { CircleXIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import type { ProductFailure } from "../../../../shared/product-failure";

/* 主文案与诊断在 DOM 上分离：role=alert 只包标题、解释和解决步骤，
 * 默认折叠的后端原文不会被读屏器当作新错误整段播报。 */

export function TurnErrorCard({
  failure,
  backend,
  backendId,
  onContinue,
}: {
  failure: ProductFailure;
  backend: string;
  backendId?: AgentBackendId;
  /** 「继续」只在失败 turn 成立，故它长在卡片里，与限流卡的「立即重试」同位 */
  onContinue?: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <AgentFailureNotice
      backend={backend}
      backendId={backendId}
      failure={failure}
    >
      {onContinue && (
        <Button
          className="relative mt-3 touch-manipulation touch-target-44 [--touch-target-inset:-4px]"
          onClick={onContinue}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("common.continue")}
        </Button>
      )}
    </AgentFailureNotice>
  );
}

/* 失败不是一条助手消息：它是一张卡片，跟 UsageLimitCard 用同一套语言。
   整块染红只会把注意力烧在背景上，图标与标题才是真正要读的那两行。 */
export function FailureCard({
  action,
  body,
  icon,
  onAct,
  title,
}: {
  action: string;
  body: string;
  icon?: ReactNode;
  onAct(): void;
  title: string;
}) {
  return (
    <div
      className="w-full min-w-0 rounded-xl border bg-muted/40 p-4"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <CircleXIcon className="size-4 shrink-0 text-destructive" />
        <span className="font-medium text-base">{title}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground text-sm">
        {body}
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onAct} size="sm" type="button" variant="outline">
          {icon}
          {action}
        </Button>
      </div>
    </div>
  );
}
