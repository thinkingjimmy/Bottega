"use client";

/**
 * [INPUT]: Depends on trusted Design data status/deletion Apps client commands, SettingsRow/SettingsButton, ConfirmationDialog, and localized copy
 * [OUTPUT]: Provides DesignDangerSection, the General tab danger zone that carries Design custody deletion and renders nothing when there is no custody to delete
 * [POS]: Design-only trusted settings rows; untrusted factory GUI cannot invoke destructive data operations
 */

/* ============================================================
 * 为什么这里只剩「删除」一件事
 *
 * 从前这块是「Design 数据与可见性」：一张卡里装着可见性开关、一串
 * 托管编号和一个不可逆动作。三件事互不相干，却共用一个标题里的「与」。
 *
 * 可见性开关走了——它调的是 setDefaultGrant，与授权页的「可用范围」
 * 写的是同一个 record.defaultGrant，载荷还不一样（这边 fileRead:true，
 * 那边 false）。两个控件写同一个字段，就必然有一个在说谎，而界面没有
 * 任何地方告诉用户是哪一个。真值只有一个，控件也就只能有一个，那个
 * 控件在授权页。
 *
 * 托管编号也走了：一串没有标签的机器码，用户既读不懂也用不上；真要
 * 排查，日志里有。
 *
 * 剩下的删除不是权限而是清空，故落在通用页的危险区末位——与
 * ProjectGeneralSection 的危险区同形，红只发给不可撤销的那一个。
 * ============================================================ */

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import {
  SettingsButton,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { deleteDesignData, readDesignDataStatus } from "@/lib/apps-client";
import type { AppRecord, DesignDataStatus } from "../../../../shared/apps-ipc";

export function DesignDangerSection({
  record,
  onError,
}: {
  record: AppRecord;
  /* 失败交给面板那条唯一的错误横幅：一个面板里两个报错位置，
     用户就得先找它在哪，再读它说什么。 */
  onError: (cause: unknown) => void;
}) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<DesignDataStatus>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    void readDesignDataStatus(record.id).then(
      (next) => active && setStatus(next)
    );
    return () => {
      active = false;
    };
  }, [record.id]);

  /* 没有托管记录就没有可删的东西——连同段标题一起不出现。让本组件自己
     判断有没有话说，调用方才不必先替它读一次 IPC 才知道要不要留位置；
     否则「危险区」会先画出一张空卡，再在下一帧填进内容。 */
  if (!status) return null;

  const confirm = () => {
    setBusy(true);
    void deleteDesignData({
      appId: record.id,
      dataCustodyId: status.dataCustodyId,
      confirmed: true,
    })
      .then(() => readDesignDataStatus(record.id).then(setStatus))
      .catch(onError)
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };

  return (
    <SettingsSection title={t("apps.settingsDanger")}>
      <SettingsList>
        <SettingsRow
          htmlFor="design-delete-data"
          label={t("apps.designDeleteData")}
          description={t("apps.designDeleteHint")}
          control={
            <SettingsButton
              disabled={busy}
              id="design-delete-data"
              onClick={() => setConfirming(true)}
              variant="destructive"
            >
              <Trash2 />
              {t("apps.designDeleteData")}
            </SettingsButton>
          }
        />
      </SettingsList>
      <ConfirmationDialog
        busy={busy}
        cancelLabel={t("common.cancel")}
        confirmLabel={t("apps.designDeleteData")}
        confirmTone="destructive"
        description={t("apps.designDeleteConfirm")}
        onConfirm={confirm}
        onOpenChange={(next) => !next && setConfirming(false)}
        open={confirming}
        title={t("apps.designDeleteTitle")}
      />
    </SettingsSection>
  );
}
