/**
 * [INPUT]: Depends on React, Setup/I18n Provider, structured AgentFailureNotice, SetupBackendRow, settings-layout, PageShell and lucide Server/RefreshCw
 * [OUTPUT]: Provides BackendsSettingsView with human-first/folded-diagnostic setup failures, backend status/version, page header, and explicit review in a 52px row list
 * [POS]: The Backends file that covers the Settings layer; The backend detection is extracted from the General and is separately partitioned into a page with the Personalization/Usage and Agents (the settings for the agent dimension) settings, so the conditions are not loaded and you can subscribe to SetupProvider only
 */

import { RefreshCw, Server } from "lucide-react";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SetupBackendRow } from "@/components/setup/backend-row";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsAlert,
  SettingsList,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { PageShell } from "@/components/page-shell";
import { AgentFailureNotice } from "@/components/agent-failure-notice";

/* ============================================================
 * 后端检测原先挤在 General 顶部，用一片 auto-fill 卡片网格铺开：一张就绪
 * 卡 116px 高，装的只是名字、版本号和两个图标，第四家还会独占一行留个洞。
 * 独立成页后改用 Onboarding 早就在用的 52px 行形态（SetupBackendRow），
 * 一家一行、后端再多也只是多一行——SettingsList 即 SettingsSurface + 行分隔。
 * ============================================================ */

export function BackendsSettingsView() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  return (
    <PageShell title={t("common.backends")} icon={<Server />}>
      <SettingsCanvas>
        <SettingsSection
          title={t("settings.backends.title")}
          description={t("settings.backends.description")}
          action={
            <SettingsButton
              variant="outline"
              disabled={setup.checking}
              onClick={() => void setup.recheck()}
            >
              <RefreshCw className={setup.checking ? "animate-spin" : ""} />
              {t("settings.backends.recheck")}
            </SettingsButton>
          }
        >
          <div className="space-y-3">
            {setup.error && (
              <AgentFailureNotice compact {...setup.error} />
            )}
            {setup.notice && <SettingsAlert tone="warn">{setup.notice}</SettingsAlert>}
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
