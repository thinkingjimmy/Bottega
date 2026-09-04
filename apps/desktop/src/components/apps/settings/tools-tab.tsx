"use client";

/**
 * [INPUT]: Depends on the App capability snapshot IPC, react-router navigation, localized status maps, and Settings primitives
 * [OUTPUT]: Provides ToolsTab — the live tool/Skill/MCP snapshot with its own re-detect revision and the exit to global tool settings
 * [POS]: The second body of components/apps/settings; the capability snapshot is read here and nowhere else
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { RefreshCw, Wrench } from "lucide-react";
import {
  SettingsBadge,
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsLinkRow,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { readAppCapabilities } from "@/lib/apps-client";
import type { AppCapabilitiesSnapshot } from "../../../../shared/apps-ipc";
import type { AppSettingsTabProps } from "./tab-shell";

/* 状态徽标的语义映射集中在这里，而不是散在 JSX 里：同一个 status 在两处
   各写一次三元表达式，迟早在两处是两种说法。 */
const TOOL_STATUS_KEY = {
  satisfied: "apps.settingsToolSatisfied",
  missing: "apps.settingsToolMissing",
  "needs-config": "apps.settingsToolNeedsConfig",
  unknown: "apps.settingsToolUnknown",
} as const;

const TOOL_STATUS_TONE = {
  satisfied: "neutral",
  missing: "warn",
  "needs-config": "warn",
  unknown: "muted",
} as const;

const HEALTH_KEY = {
  healthy: "apps.settingsToolSatisfied",
  missing: "apps.settingsToolMissing",
  unknown: "apps.settingsToolUnknown",
} as const;

const HEALTH_TONE = {
  healthy: "neutral",
  missing: "warn",
  unknown: "muted",
} as const;

export function ToolsTab({ record, fail, onClose }: AppSettingsTabProps) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [capabilities, setCapabilities] = useState<AppCapabilitiesSnapshot | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void readAppCapabilities(record.id)
      .then((next) => { if (active) setCapabilities(next); })
      .catch((cause) => { if (active) fail(cause, t("apps.settingsReadFailed")); });
    return () => { active = false; };
  }, [fail, record.id, revision, t]);

  /* 空态判据是三个来源同时为空。旧版只看 tools.length，于是「没有额外
     工具」会印在一串 Skill/MCP 之上——一句当场被下文推翻的判词。 */
  const toolsEmpty = Boolean(
    capabilities &&
    capabilities.tools.length === 0 &&
    capabilities.agentTools.skills.length === 0 &&
    capabilities.agentTools.mcpServers.length === 0
  );

  return (
    <SettingsCanvas>
      <SettingsSection
        action={
          <SettingsButton
            onClick={() => setRevision((value) => value + 1)}
            variant="outline"
          >
            <RefreshCw />
            {t("apps.settingsRedetect")}
          </SettingsButton>
        }
        description={t("apps.settingsToolsHint")}
        title={t("apps.settingsLiveSnapshot")}
      >
        {toolsEmpty ? (
          <SettingsEmpty
            hint={t("apps.settingsNoToolsHint")}
            icon={<Wrench />}
            title={t("apps.settingsNoTools")}
          />
        ) : (
          <SettingsList>
            {capabilities?.tools.map((item) => (
              <SettingsRow
                key={item.requirement.id}
                label={item.requirement.label}
                description={item.guidance}
                control={
                  <SettingsBadge tone={TOOL_STATUS_TONE[item.status]}>
                    {t(TOOL_STATUS_KEY[item.status])}
                  </SettingsBadge>
                }
              />
            ))}
            {capabilities?.agentTools.skills.map((item) => (
              <SettingsRow
                key={`skill:${item.name}`}
                label={item.name}
                description={t("apps.settingsToolKindSkill")}
                control={
                  <SettingsBadge tone={HEALTH_TONE[item.health]}>
                    {t(HEALTH_KEY[item.health])}
                  </SettingsBadge>
                }
              />
            ))}
            {capabilities?.agentTools.mcpServers.map((item) => (
              <SettingsRow
                key={`mcp:${item.name}`}
                label={item.name}
                description={t("apps.settingsToolKindMcp")}
                control={
                  <SettingsBadge tone={HEALTH_TONE[item.health]}>
                    {t(HEALTH_KEY[item.health])}
                  </SettingsBadge>
                }
              />
            ))}
            {/* 去全局页是本 tab 的出口，不是它的第一件事：外跳行落在清单
                末尾，整行都是命中区——从前那颗 ghost 按钮不到 100px，
                行却有 400px，剩下那段读起来像能点，按下去什么也不会发生。 */}
            <SettingsLinkRow
              description={t("apps.settingsOpenGlobalToolsHint")}
              label={t("apps.settingsOpenGlobalTools")}
              onSelect={() => {
                onClose();
                void navigate(capabilities?.settings.toolsPath ?? "/settings/tools");
              }}
            />
          </SettingsList>
        )}
      </SettingsSection>
    </SettingsCanvas>
  );
}
