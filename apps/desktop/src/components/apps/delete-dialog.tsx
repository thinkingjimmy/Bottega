/**
 * [INPUT]: Depends on Apps i18n, UI dialog/button/spinner, cn, and shared RemoveAppMode
 * [OUTPUT]: Provides AppDeleteDialog, Base retention choices, and ordinary-App cascade confirmation that discloses Project chat deletion
 * [POS]: Sole Apps deletion decision surface consumed by AppCard alongside repair-dialog
 */

import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import type { RemoveAppMode } from "../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type AppDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isBase: boolean;
  error?: string;
  /** 返回 true 表示删除成功、弹窗该退场；失败由调用方写进 error。 */
  onDelete: (mode: RemoveAppMode) => Promise<boolean>;
};

/* ── 一个弹窗两种形态 ──────────────────────────────────────────────
 * Base App 的删除是**选择**：App 壳走定了，要定的是数据的去向。
 * Web App 的删除是**确认**：只有一条路，要定的是走不走。
 *
 * 两者不该共用一行按钮。选择题里的「取消」是第三个平权按钮，与两个
 * 真选项同为 outline、彼此相邻，而误点代价天差地别——它不是多余，是
 * 危险；何况 ×／Esc／遮罩已经说了三遍「不选」。确认题里的「取消」却
 * 是必需的：它是那个明确的、大的安全出口，也是打开时的默认焦点，
 * 没有它，回车就等于删除。
 *
 * 选择题的描述句随之消失。原来那句「你可以只删除 App 壳并保留……，
 * 也可以连数据一起永久删除」是在替两个按钮转述它们自己该说的话；
 * 后果贴回选项本体，散文就没有存在的理由了。
 * ────────────────────────────────────────────────────────────────── */
export function AppDeleteDialog({
  open,
  onOpenChange,
  name,
  isBase,
  error,
  onDelete,
}: AppDeleteDialogProps) {
  const { t } = useAppTranslation();
  const [pending, setPending] = useState<RemoveAppMode | null>(null);

  const run = async (mode: RemoveAppMode) => {
    setPending(mode);
    const done = await onDelete(mode);
    setPending(null);
    if (done) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      // 删除在飞时闸住所有出口：×、Esc、遮罩全从这里过，一处守住三条路。
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      {isBase ? (
        // 描述句已拆进选项，显式声明无 description，免得 Radix 误报缺失。
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t("apps.deleteDialog.title", { name })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <DeleteChoice
              title={t("apps.deleteDialog.retainTitle")}
              detail={t("apps.deleteDialog.retainDetail")}
              busy={pending === "retain-data"}
              disabled={pending !== null}
              onClick={() => void run("retain-data")}
            />
            <DeleteChoice
              danger
              title={t("apps.deleteDialog.cascadeTitle")}
              detail={t("apps.deleteDialog.cascadeDetail")}
              busy={pending === "cascade"}
              disabled={pending !== null}
              onClick={() => void run("cascade")}
            />
          </div>
          <DeleteError message={error} />
        </DialogContent>
      ) : (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apps.deleteDialog.title", { name })}</DialogTitle>
            <DialogDescription>
              {t("apps.deleteDialog.webDescription")}
            </DialogDescription>
          </DialogHeader>
          <DeleteError message={error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending !== null}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              className="border-destructive/30"
              disabled={pending !== null}
              onClick={() => void run("cascade")}
            >
              {/* Spinner 自带 size-4，Button 的 svg 兜底选择器认 class 里的
                  size- 就不再插手；不显式对齐 size-3.5 它会比同排图标大一圈。 */}
              {pending && <Spinner className="size-3.5" />}
              {t("apps.deleteDialog.deleteFiles")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* 失败时弹窗不关，而 openError 挂在卡片上——正被这张弹窗盖住。报错要落在
   读者眼睛所在的那一层，否则点了删除就是石沉大海。 */
function DeleteError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-destructive text-xs" role="alert">
      {message}
    </p>
  );
}

/* 选项行不是 Button 的一种 variant：它要放两行字、左对齐、随宽换行，而
   Button 焊死了 h-7 / whitespace-nowrap / justify-center。掰这三条比自己
   长一个更脏。危险项静置时与安全项等重——它是正当选择而非陷阱，红只落在
   标题与悬停上，让人在按下之前而不是看见之时收到警告。 */
function DeleteChoice({
  title,
  detail,
  danger,
  busy,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  danger?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md border border-border bg-clip-padding px-3 py-2 text-left transition-all outline-none dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none",
        danger
          ? "hover:border-destructive/40 hover:bg-destructive/10 focus-visible:border-destructive/40 focus-visible:ring-destructive/20"
          : "hover:bg-input/50",
        // 只暗掉没被点的那个：正在跑的那行还要靠自己的 spinner 说话。
        disabled && !busy && "opacity-50"
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 font-medium",
          danger && "text-destructive"
        )}
      >
        {busy && <Spinner className="size-3" />}
        {title}
      </span>
      <span className="mt-0.5 block text-muted-foreground">{detail}</span>
    </button>
  );
}
