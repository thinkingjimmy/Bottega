/**
 * [INPUT]: Depends on Apps i18n, the shared AppDialogContent/DialogChoice/ConfirmationDialog primitives, and shared RemoveAppMode
 * [OUTPUT]: Provides AppDeleteDialog, Base retention choices carrying their own consequence, and ordinary-App cascade confirmation that discloses Project chat deletion
 * [POS]: Sole Apps deletion decision surface consumed by AppCard alongside repair-dialog
 */

import { useState } from "react";
import { Database, Trash2 } from "lucide-react";
import {
  AppDialogContent,
  ConfirmationDialog,
  DialogChoice,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import type { RemoveAppMode } from "../../../../shared/apps-ipc";
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
 * 两者不该共用一行按钮。选择题里的「取消」是第三个平权按钮，与两个真选项
 * 同为 outline、彼此相邻，而误点代价天差地别——它不是多余，是危险；何况
 * ×／Esc／遮罩已经说了三遍「不选」。确认题里的「取消」却是必需的：它是那个
 * 明确的、大的安全出口，也是打开时的默认焦点，没有它，回车就等于删除。
 *
 * 选择题的描述句随之消失。原来那句「你可以只删除 App 壳并保留……，也可以
 * 连数据一起永久删除」是在替两个按钮转述它们自己该说的话；后果贴回选项
 * 本体，散文就没有存在的理由了。
 *
 * 选项行走 Fork 那套呈现：不画框。两张带框的卡读作两个容器，你得先认出
 * 它们可按，才开始读它们说什么；两行无框带 hover 底，一眼就是「按其中
 * 一个」。同样的信息，少一圈没有职责的描边，问题于是压得住答案。
 *
 * 左边那个槽不是装饰：Database 与 Trash2 说的正是这道题的分歧所在——Base
 * 留下还是一起删。它同时是 spinner 的家，行在忙起来时几何一分不动；从前
 * spinner 插在标题前面，按下去标题就整体右移一次。
 *
 * 从 Fork 那边**没有**照搬的是它的 gap-0 和无差别配色：两个 hover 区贴死，
 * 指针从「保留数据」滑到「连数据一起删」中间没有死区；而危险项若与安全项
 * 等重，警告就只有本来在读的人才读得到。这两条留 Delete 自己的。
 *
 * 两件事故意不动：选择题仍然没有描述句；危险项静置时仍与安全项等重，红只
 * 落在标题与悬停上——它是正当选择而非陷阱，警告要在按下之前而不是看见之时
 * 到达。
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

  /* 确认题整颗交给原语：busy 已经替我们闸住 ×／Esc／遮罩三条出口，
     焦点默认落在 Cancel 上，spinner 落在被按下的那颗按钮上。 */
  if (!isBase) {
    return (
      <ConfirmationDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t("apps.deleteDialog.title", { name })}
        /* 最后那句是这段话里唯一会让人意外的：App 的仓库和环境跟着 App 走是
           预期之内，绑定 Project 的聊天一并没了不是。它与前文同为 muted 时，
           是一句读完就滑过去的背景；提到前景色，它才是那条要被读到的。 */
        description={
          <>
            {t("apps.deleteDialog.webDescription")}{" "}
            <strong className="font-medium text-foreground">
              {t("apps.deleteDialog.webProjectNote")}
            </strong>
            <DeleteError message={error} />
          </>
        }
        confirmLabel={t("apps.deleteDialog.deleteFiles")}
        confirmTone="destructive"
        busy={pending !== null}
        onConfirm={() => void run("cascade")}
      />
    );
  }

  return (
    <Dialog
      open={open}
      // 删除在飞时闸住所有出口：×、Esc、遮罩全从这里过，一处守住三条路。
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      {/* 描述句已拆进选项，显式声明无 description，免得 Radix 误报缺失。 */}
      <AppDialogContent aria-describedby={undefined}>
        <DialogHeader className="min-h-0 gap-0 overflow-y-auto text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {t("apps.deleteDialog.title", { name })}
          </DialogTitle>
        </DialogHeader>
        {/* 负外边距让 hover 底铺到内边距的边上，行内文字则与标题左侧对齐：
            填色比文字宽出去一圈，才像一份可按的清单而不是两段缩进的正文。 */}
        <div className="-mx-2.5 mt-4 grid shrink-0 gap-2">
          <DialogChoice
            icon={<Database />}
            variant="plain"
            title={t("apps.deleteDialog.retainTitle")}
            detail={t("apps.deleteDialog.retainDetail")}
            busy={pending === "retain-data"}
            disabled={pending !== null}
            onClick={() => void run("retain-data")}
          />
          <DialogChoice
            icon={<Trash2 />}
            variant="plain"
            tone="danger"
            title={t("apps.deleteDialog.cascadeTitle")}
            detail={t("apps.deleteDialog.cascadeDetail")}
            busy={pending === "cascade"}
            disabled={pending !== null}
            onClick={() => void run("cascade")}
          />
        </div>
        <DeleteError message={error} />
      </AppDialogContent>
    </Dialog>
  );
}

/* 失败时弹窗不关，而 openError 挂在卡片上——正被这张弹窗盖住。报错要落在
   读者眼睛所在的那一层，否则点了删除就是石沉大海。 */
function DeleteError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-3 text-[13px] text-destructive" role="alert">
      {message}
    </p>
  );
}
