/**
 * [INPUT]: Depends on shared AgentFailureNotice, the touch-target-44 hit-area utility, ProductFailure/backend identity, UI Button, and the common localized Continue action
 * [OUTPUT]: Provides TurnErrorCard with localized human-first copy, folded diagnostics, and optional continuation action
 * [POS]: Default structured Agent failure card for chat/transcript, selected by ChatTurn when no specialized usage-limit surface applies
 */

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
