/**
 * [INPUT]: Depends on React, Setup/I18n Provider, SetupBackendRow, settings-layout of SettingsCanvas/SettingsSection/SettingsList/SettingsButton, PageShell and lucide Server/RefreshCw
 * [OUTPUT]: Provides BackendsSettingsView to cover the Backends view under the Agents group; Present the backend status/version with on-site action, page header and explicit review in a 52px row list
 * [POS]: The Backends file that covers the Settings layer; The backend detection is extracted from the General and is separately partitioned into a page with the Personalization/Usage and Agents (the settings for the agent dimension) settings, so the conditions are not loaded and you can subscribe to SetupProvider only
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
          alert={setup.error}
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
          <SettingsList>
            {setup.status?.backends.map((backend) => (
              <SetupBackendRow key={backend.id} backend={backend} />
            ))}
          </SettingsList>
        </SettingsSection>
      </SettingsCanvas>
    </PageShell>
  );
}
