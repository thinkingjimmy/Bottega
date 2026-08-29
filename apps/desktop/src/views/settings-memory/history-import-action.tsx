/**
 * [INPUT]: Depends on History renderer client eligibility/preview/commit, useOptionalHistory delivering snapshot, i18n, SettingsButton and ConfirmationDialog
 * [OUTPUT]: Provides useHistoryMemoryImport: the import entry split into action / alert / dialog nodes for a host section to place
 * [POS]: Settings › Memory history import entry; it no longer owns a section but hangs on the header of the numbers it fills, paired with the rebuild that clears them; confirm returns acceptance, not delivery — delivering reads the live event stream
 */

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownToLine } from "lucide-react";
import type {
  HistoryMemoryEligibility,
  HistoryMemoryPreview,
} from "../../../shared/history-import-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { SettingsButton } from "@/components/settings/settings-layout";
import { errorMessage } from "@/lib/errors";
import {
  commitHistoryMemory,
  historyMemoryEligibility,
  previewHistoryMemory,
} from "@/lib/history/client";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";

/* ============================================================
 * 导入入口：一颗按钮、一条状态、一个弹窗，分三处落地。
 *
 * 它从前自立一节「已有 Agent 历史」：段标题、段描述、一张只装一行的
 * SettingsList、行标签、行描述，最后才是按钮——同一个入口报了三次名。
 * 而段描述与行描述在 chat 范围下取的是同一个 key，逐字相同：那一行
 * 携带的信息量为零，卡片也没有任何兄弟可分隔。
 *
 * 判据是这一页自己写下的：动作挂在它所作用的那片内容的段头上。导入
 * 填充的正是「重建记忆」清空的那片数字——累计交付 turn 会涨，供给明细
 * 里会长出「外部导入的历史」那一行。一对反向动作，理应同一个宿主。
 *
 * 于是这里不再返回一棵完整的树，而是三个节点：宿主把 action 放进段头、
 * alert 放进告警槽，dialog 走 Portal 与位置无关。
 *
 * 搬家不会让入口失踪：visible = hasAuthorization，而它要求 state.enabled；
 * 记忆开着，「运行观测」就一定在场。
 *
 * 按钮不再说「预览」。预览是弹窗的事——一个会弹确认框的按钮本来就承诺了
 * 「还有机会看一眼再决定」，把这件事写进标签是在解释实现。标签只说它为你
 * 办成什么，范围细则退到弹窗里，随范围改写。
 * ============================================================ */

export function useHistoryMemoryImport(refreshKey: string): {
  action: ReactNode;
  alert: ReactNode;
  dialog: ReactNode;
} {
  const { t, i18n } = useAppTranslation();
  /* 确认即受理：commit 返回只代表 Grant 已落盘，交付仍在后台泵里。
     delivering 直接读事件流快照，收尾/中断都不需要这里轮询。 */
  const delivering = useOptionalHistory()?.snapshot.memoryDelivering ?? false;
  const [eligibility, setEligibility] = useState<HistoryMemoryEligibility | null>(null);
  const [preview, setPreview] = useState<HistoryMemoryPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  /* delivering 落定也重拉 eligibility：后台失败会把 interruptedGrant 翻真，
     这一拍不刷新的话，告警要等下次进页才出现。 */
  useEffect(() => {
    let active = true;
    void historyMemoryEligibility({ surface: "settings" })
      .then((next) => { if (active) setEligibility(next); })
      .catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [refreshKey, delivering]);

  const formatDate = (value: number | null) =>
    value === null ? "—" : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value);

  const prepare = async () => {
    setBusy(true);
    setError("");
    setComplete(false);
    try {
      setPreview(await previewHistoryMemory({ includeProductChats: true }));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await commitHistoryMemory(preview.snapshotId, preview.digest);
      setPreview(null);
      setComplete(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  /* settings surface 上 enabled ≡ visible：memory-grant-coordinator.ts 里
     historyEnabled 无 projectId 时恒真，surface === "settings" 又让第三个
     合取项恒短路。于是只剩「显示」与「不显示」两态——从前那条 unavailable
     分支与它的 settingsImportUnavailable 文案永远走不到，一并撤掉。 */
  const visible = Boolean(eligibility?.visible);

  return {
    action: visible ? (
      <SettingsButton
        id="history-memory-import"
        variant="outline"
        disabled={busy}
        onClick={() => void prepare()}
      >
        <ArrowDownToLine />
        {t("history.settingsImportAction")}
      </SettingsButton>
    ) : null,
    alert: visible
      ? error || (complete
        ? t(delivering ? "history.settingsDelivering" : "history.settingsComplete")
        : eligibility?.interruptedGrant ? t("history.interruptedGrant") : undefined)
      : undefined,
    dialog: (
      <ConfirmationDialog
        open={preview !== null}
        onOpenChange={(open) => { if (!open && !busy) setPreview(null); }}
        title={t("history.settingsPreviewTitle")}
        description={preview ? (
          /* 先说这是干什么的，再摆事实，最后才是随范围改写的那一句。
             chat 与 personal 各有一条限制，两者对称——页面上不再解释范围，
             解释都归这里。 */
          <div className="space-y-3 text-left">
            <p>{t("history.settingsImportDescription")}</p>
            <p>{t("history.settingsPreviewSummary", {
              chats: preview.chats,
              turns: preview.turns,
              from: formatDate(preview.from),
              to: formatDate(preview.to),
            })}</p>
            {preview.sharingMode === "chat" && <p>{t("history.settingsProductOnly")}</p>}
            {preview.sharingMode === "personal" && <p>{t("history.personalCrossProject")}</p>}
            <p>{t("history.settingsPreviewDisclosure")}</p>
            <p>{t("history.memoryRetained")}</p>
            <code className="block break-all rounded-md bg-muted px-3 py-2 text-xs">
              {preview.digest}
            </code>
            {error && <p className="text-destructive" role="alert">{error}</p>}
          </div>
        ) : null}
        confirmLabel={t("history.settingsConfirm")}
        cancelLabel={t("common.cancel")}
        busy={busy}
        onConfirm={() => void commit()}
      />
    ),
  };
}
