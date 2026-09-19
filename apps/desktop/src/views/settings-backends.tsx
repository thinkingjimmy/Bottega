/**
 * [INPUT]: Depends on SetupProvider, visible-page freshness, shared Agent rows/feedback and Settings layout.
 * [OUTPUT]: Provides Agent Settings with global manual refresh, row-local recovery, version details, check timestamps and durable default execution-device selection and explicit Agent onboarding navigation.
 * [POS]: Settings route for Agent configuration; state and actions are shared with Onboarding.
 */

import { RefreshCw, Server } from "lucide-react";
import { useDefaultExecutionDevice } from "@/components/setup/default-execution-device";
import { SettingsRow } from "@/components/settings/settings-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SetupBackendRow } from "@/components/setup/backend-row";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { PageShell } from "@/components/page-shell";
import { SetupFeedbackNotice } from "@/components/setup/backend-feedback";
import { useSetupRefresh } from "@/components/providers/availability/use-setup-refresh";

/* ============================================================
 * 后端检测原先挤在 General 顶部，用一片 auto-fill 卡片网格铺开：一张就绪
 * 卡 116px 高，装的只是名字、版本号和两个图标，第四家还会独占一行留个洞。
 * 独立成页后改用 Onboarding 早就在用的 52px 行形态（SetupBackendRow），
 * 一家一行、后端再多也只是多一行——SettingsList 即 SettingsSurface + 行分隔。
 * ============================================================ */

export function BackendsSettingsView() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const preference = useDefaultExecutionDevice();
  useSetupRefresh();
  return (
    <PageShell title={t("common.backends")} icon={<Server />}>
      <SettingsCanvas>
        {(window.cloud || preference.deviceId) && <SettingsSection title={t("settings.backends.defaultExecutionDevice")}>
          <SettingsList><SettingsRow label={t("settings.backends.defaultExecutionDevice")} description={t("settings.backends.defaultExecutionDescription")} control={
            <Select value={preference.deviceId ?? "local"} disabled={preference.saving} onValueChange={value => void preference.select(value === "local" ? null : value)}>
              <SelectTrigger aria-label={t("settings.backends.defaultExecutionDevice")} className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="local">{t("settings.backends.localExecutionDevice")}</SelectItem>
                {preference.deviceId && !preference.items.some(item => item.deviceId === preference.deviceId) && <SelectItem value={preference.deviceId} disabled>{preference.copy.chooseComputer}</SelectItem>}
                {preference.items.map(item => <SelectItem key={item.deviceId} value={item.deviceId} disabled={!preference.available}>{item.name}{!item.online ? ` · ${preference.copy.offline}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          } /></SettingsList>
          {preference.error && <p role="alert" className="text-sm text-destructive">{preference.error}</p>}
        </SettingsSection>}
        <SettingsSection
          title={t("settings.backends.title")}
          description={t("settings.backends.description")}
          action={
            <div className="flex flex-wrap items-center gap-2">
            <SettingsButton variant="outline" onClick={() => setup.openOnboarding("agent")}>{t("setup.configure")}</SettingsButton>
            <SettingsButton
              variant="outline"
              disabled={setup.checking}
              onClick={() => void setup.recheck()}
            >
              <RefreshCw className={setup.checking ? "animate-spin motion-reduce:animate-none" : ""} />
              {t("settings.backends.recheck")}
            </SettingsButton>
            </div>
          }
        >
          <div className="space-y-3">
            {setup.error && (
              <SetupFeedbackNotice feedback={setup.error} onRetry={() => void setup.reload()} disabled={setup.checking} />
            )}
            <SettingsList>
              {setup.status?.backends.map((backend) => (
                <SetupBackendRow key={backend.id} backend={backend} />
              ))}
            </SettingsList>
          </div>
        </SettingsSection>
      </SettingsCanvas>
    </PageShell>
  );
}
