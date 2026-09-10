/**
 * [INPUT]: Depends on Apps i18n and the shared ConfirmationDialog primitive
 * [OUTPUT]: Provides RepairConfirmDialog, maintains Agent Red Line security confirmation for repairs
 * [POS]: Sole Apps repair-risk confirmation shared by cards and detail surfaces
 */

import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { useAppTranslation } from "@/components/providers/i18n-provider";

type RepairConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy?: boolean;
  onConfirm: () => void;
};

/* ── 红线告知要排得像红线 ────────────────────────────────────────────
 * 这段话说的是「仓库命令以你的用户权限运行，恶意内容可能诱导非预期操作」。
 * 它此前排在 384px 盒子里的 12px 正文上——全 App 最小的字号配最重的遮罩，
 * 而一次可重试的会话恢复失败拿到的是 20px 标题、15px 正文。危险程度与视觉
 * 权重成反比。走 ConfirmationDialog 之后两者同权。
 *
 * 末句单独成键：前三句陈述这次修复会发生什么，只有它要求读者做判断
 * （「仅对你信任的仓库使用」）。与前文同为 muted 时它是一句读完就滑过去的
 * 背景，提到前景色才是那条指令。
 *
 * 焦点落在 Cancel 上从此是声明而不是巧合——此前回车不启动修复，仅仅因为
 * Cancel 恰好排在 DOM 靠前的位置。× 随之撤掉：Cancel 就是那个出口，同一条
 * 出路挂两块牌子只会让人以为还有第三条。
 * ────────────────────────────────────────────────────────────────── */
export function RepairConfirmDialog({
  open,
  onOpenChange,
  busy = false,
  onConfirm,
}: RepairConfirmDialogProps) {
  const { t } = useAppTranslation();
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("apps.repair.title")}
      description={
        <>
          {t("apps.repair.description")}{" "}
          <strong className="font-medium text-foreground">
            {t("apps.repair.trustNote")}
          </strong>
        </>
      }
      confirmLabel={t("apps.repair.start")}
      busy={busy}
      onConfirm={onConfirm}
    />
  );
}
