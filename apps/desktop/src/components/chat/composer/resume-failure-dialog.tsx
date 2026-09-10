/**
 * [INPUT]: Depends on i18n, the shared AppDialogContent shell and DialogChoice option row, the selected backend's display name, and the chat composer recovery controller
 * [OUTPUT]: Provides a non-dismissible ResumeFailureDialog whose three recovery paths each carry their own consequence, moving the recommendation to a fresh session once a retry has already failed
 * [POS]: The recovery decision boundary in chat/composer; a failed durable turn always retains an immediately reachable decision surface
 */

import { useRef, useState } from "react";
import {
  AppDialogContent,
  DialogChoice,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ChatSessionController } from "../runtime/use-chat-session";

type ResumeFailureController = Pick<
  ChatSessionController["composer"],
  | "resumeFailure"
  | "selectedBackend"
  | "retrySameSession"
  | "retryWithoutSession"
  | "abandonResumeFailure"
>;

type ResumeAction = "sameSession" | "freshSession";

/* ── 这是一道选择题，不是一次确认 ──────────────────────────────────
 * 三条恢复路径的差别全在**代价**上：留在原会话最省、换新会话丢的是
 * Agent 自己的会话记忆、放弃则这一轮不跑。一排平权药丸只装得下动词，
 * 代价无处可写，读者于是没有判据——「我根本不知道该选哪个」正由此来。
 * 故沿用删除 Apps 那套选项行：后果贴回选项本体，描述句只说事实。
 *
 * 弹窗不可关闭（无 ×／Esc／点遮罩），因为「放弃这一轮」就是那个出口，
 * 且它是一个真实的、有后果的答案——藏进页脚会让人以为还有第四条路。
 * ────────────────────────────────────────────────────────────────── */
export function ResumeFailureDialog({
  controller,
}: {
  controller: ResumeFailureController;
}) {
  const { t } = useAppTranslation();
  const failure = controller.resumeFailure;
  const [pending, setPending] = useState<ResumeAction | null>(null);
  const [error, setError] = useState("");
  const sameRef = useRef<HTMLButtonElement>(null);
  const freshRef = useRef<HTMLButtonElement>(null);
  const abandonRef = useRef<HTMLButtonElement>(null);

  const backend = controller.selectedBackend?.displayName ?? "Agent";
  const allowed = failure?.allowedActions;
  const retried = failure?.retried === true;
  /* 重试过一次还落回这里，原会话大概率是真的没了：推荐位随之换人，
     否则这张弹窗第二次出现时给的仍是刚被证伪的那条建议。

     retried 能直接读成「重试原会话失败过」，是因为 resume-failed 只可能
     从恢复既有 session 的那条路来（session 缺失 → establish 返回 undefined）；
     换新会话的重试已把 payload.session 清空，再失败会走终态而不是回到这里。 */
  const leading: ResumeAction =
    retried && allowed?.freshSession ? "freshSession" : "sameSession";

  const run = async (action: ResumeAction) => {
    setPending(action);
    setError("");
    try {
      await (action === "sameSession"
        ? controller.retrySameSession()
        : controller.retryWithoutSession());
    } catch (cause) {
      /* 弹窗关不掉，失败又无处可去——不落在这一层就是石沉大海。 */
      setError(
        t("chat.resumeFailure.actionFailed", { message: errorMessage(cause) })
      );
    } finally {
      setPending(null);
    }
  };

  const sameSession = (
    <DialogChoice
      key="sameSession"
      ref={sameRef}
      title={t(
        retried
          ? "chat.resumeFailure.sameSessionRetry"
          : "chat.resumeFailure.sameSession"
      )}
      detail={t(
        retried
          ? "chat.resumeFailure.sameSessionRetryDetail"
          : "chat.resumeFailure.sameSessionDetail"
      )}
      badge={
        leading === "sameSession"
          ? t("chat.resumeFailure.recommended")
          : undefined
      }
      busy={pending === "sameSession"}
      disabled={pending !== null || !allowed?.sameSession}
      onClick={() => void run("sameSession")}
    />
  );

  const freshSession = (
    <DialogChoice
      key="freshSession"
      ref={freshRef}
      title={t("chat.resumeFailure.freshSession")}
      /* 不可用时不撤走这一行：一个凭空消失的选项是一道没人回答的问题。 */
      detail={t(
        allowed?.freshSession
          ? "chat.resumeFailure.freshSessionDetail"
          : "chat.resumeFailure.freshSessionBlocked"
      )}
      badge={
        leading === "freshSession"
          ? t("chat.resumeFailure.recommended")
          : undefined
      }
      busy={pending === "freshSession"}
      disabled={pending !== null || !allowed?.freshSession}
      onClick={() => void run("freshSession")}
    />
  );

  return (
    <Dialog open={Boolean(failure)} onOpenChange={() => undefined}>
      <AppDialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const preferred = leading === "freshSession" ? freshRef : sameRef;
          [preferred, sameRef, freshRef, abandonRef]
            .find((target) => target.current && !target.current.disabled)
            ?.current?.focus();
        }}
      >
        <DialogHeader className="min-h-0 gap-0 overflow-y-auto text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {retried
              ? t("chat.resumeFailure.retriedTitle")
              : t("chat.resumeFailure.title", { backend })}
          </DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4] text-muted-foreground">
            {retried
              ? t("chat.resumeFailure.retriedDescription", { backend })
              : t("chat.resumeFailure.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid shrink-0 gap-2">
          {leading === "freshSession"
            ? [freshSession, sameSession]
            : [sameSession, freshSession]}
          <DialogChoice
            ref={abandonRef}
            tone="danger"
            title={t("chat.resumeFailure.abandon")}
            detail={t("chat.resumeFailure.abandonDetail")}
            disabled={pending !== null || !allowed?.abandon}
            onClick={controller.abandonResumeFailure}
          />
        </div>

        {error && (
          <p className="mt-3 shrink-0 text-[13px] text-destructive" role="alert">
            {error}
          </p>
        )}
      </AppDialogContent>
    </Dialog>
  );
}
