/**
 * [INPUT]: Depends on React local state, Apps i18n, app-state keys, shared AppOperation/AppRecord, and the shared AppDialog primitives
 * [OUTPUT]: Provides AppProgressDialog with operation-specific live status, cancellable install/update/repair logs, and a non-cancellable deletion surface
 * [POS]: AppsListView progress surface; deletion is projected as its own durable operation instead of falling back to installation semantics
 */

import { useState } from "react";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { AppOperation, AppRecord } from "../../../../shared/apps-ipc";
import {
  cancelOperationLabelKey,
  effectiveAppOperation,
  isCancelableOperation,
  isWorkingState,
  progressAriaKey,
  progressTitleKey,
} from "../app-state";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type AppProgressDialogProps = {
  record: AppRecord;
  step?: string;
  operation?: AppOperation;
  logPreview: string;
  onCancel: () => void;
  onShowLog: () => void;
};

/* ── 672px 是这里唯一正当的宽度 ────────────────────────────────────
 * 它比同族弹窗宽，因为它装日志——宽度阶梯里 520 是默认，672 留给「内容真的
 * 要求」的那一类（日志、文件清单）。宽度保留，换掉的是外壳与字号。
 *
 * 那个 amber 圆环是这五个弹窗里唯一硬编码的色相，也是唯一没写 dark 分支的
 * （同目录 Share 的 README 提示就写了 dark:text-amber-300）。换成 token 对，
 * 两种模式一起解决，也不必再记得补分支。它本来也没在表达「警告」——它表达
 * 的是「在跑」，而 spinner 已经把这件事说完了。
 *
 * 页脚原本是 size="sm"（24px），全 App 弹窗页脚里最小的一对；药丸之后与其余
 * 四个弹窗齐平，并各自带上 44px 命中区。取消键上的垃圾桶图标一并撤掉：按钮
 * 写着「取消安装」，图标画的是「删除」，而药丸页脚在这套系统里本就不带图标。
 * ────────────────────────────────────────────────────────────────── */
export function AppProgressDialog({
  record,
  step,
  operation,
  logPreview,
  onCancel,
  onShowLog,
}: AppProgressDialogProps) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(true);
  const effectiveOperation = effectiveAppOperation(record, operation);
  const deleting = effectiveOperation === "delete";
  return (
    <Dialog
      open={open && isWorkingState(record.state)}
      onOpenChange={setOpen}
    >
      <AppDialogContent
        className="sm:max-w-2xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="mb-4 shrink-0 gap-0 pr-8 text-left">
          <div className="flex items-center gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
              <Spinner
                className="size-5"
                aria-label={t(progressAriaKey[effectiveOperation])}
              />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-xl/7 font-semibold">
                {t(progressTitleKey[effectiveOperation])}
              </DialogTitle>
              <DialogDescription
                aria-live="polite"
                className="mt-0.5 text-[15px]/[1.4]"
              >
                {step || t(
                  deleting
                    ? "apps.progress.deletingDescription"
                    : "apps.progress.preparing"
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {deleting ? (
          <p
            className="shrink-0 rounded-lg bg-muted px-4 py-3 text-[15px]/[1.4] text-muted-foreground"
            role="note"
          >
            {t("apps.progress.deletingNotCancellable")}
          </p>
        ) : (
          <>
            <AppDialogBody className="flex flex-col gap-2.5">
              <p className="text-[13px]/[1.45] font-medium text-muted-foreground">
                {t("apps.progress.latestLog")}
              </p>
              <SlimScroller asChild>
                <pre className="max-h-[min(24rem,50vh)] min-h-36 overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap">
                  {logPreview || t("apps.progress.waitingLog")}
                </pre>
              </SlimScroller>
            </AppDialogBody>
            <DialogFooter className="mt-4 shrink-0 sm:gap-3">
              {isCancelableOperation(effectiveOperation) && (
                <Button
                  size="pill"
                  variant="destructive"
                  className="border-destructive/15"
                  onClick={onCancel}
                >
                  {t(cancelOperationLabelKey[effectiveOperation])}
                </Button>
              )}
              <Button
                size="pill"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  onShowLog();
                }}
              >
                {t("apps.progress.showLog")}
              </Button>
            </DialogFooter>
          </>
        )}
      </AppDialogContent>
    </Dialog>
  );
}
