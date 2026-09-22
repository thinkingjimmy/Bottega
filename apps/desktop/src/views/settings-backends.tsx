/**
 * [INPUT]: Depends on SetupProvider, visible-page freshness, shared Agent rows/feedback and Settings layout.
 * [OUTPUT]: Provides Agent Settings with global manual refresh, row-local recovery, version details, check timestamps and explicit Agent onboarding navigation.
 * [POS]: Settings route for Agent configuration; state and actions are shared with Onboarding.
 */

import { RefreshCw, Server } from "lucide-react";
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
  useSetupRefresh();
  return (
    <PageShell title={t("common.backends")} icon={<Server />}>
      <SettingsCanvas>
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
