"use client";

/**
 * [INPUT]: Depends on the App extension status/revoke/rebuild IPC, react-router navigation, and Settings primitives
 * [OUTPUT]: Provides PluginsTab — declared Agent plugins with their four independent badges, plus the revoke and rebuild-generation actions
 * [POS]: The third body of components/apps/settings; the extension snapshot is read here and nowhere else
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Blocks, RefreshCw } from "lucide-react";
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
import {
  readAppExtensionStatus,
  rebuildAppExtensionGeneration,
  revokeAppExtensionGrant,
} from "@/lib/apps-client";
import type {
  AppExtensionRequirementStatus,
  AppExtensionStatus,
} from "../../../../shared/apps-ipc";
import type { AppSettingsTabProps } from "./tab-shell";

export function PluginsTab({ record, busy, fail, run, onClose }: AppSettingsTabProps) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [extensions, setExtensions] = useState<AppExtensionStatus | null>(null);

  useEffect(() => {
    let active = true;
    void readAppExtensionStatus(record.id)
      .then((next) => { if (active) setExtensions(next); })
      .catch((cause) => { if (active) fail(cause, t("apps.settingsReadFailed")); });
    return () => { active = false; };
  }, [fail, record.id, t]);

  return (
    <SettingsCanvas>
      <div className="space-y-8">
        <SettingsSection
          description={t("apps.settingsPluginsHint")}
          title={t("apps.settingsPluginsTitle")}
        >
          {extensions && extensions.requirements.length === 0 ? (
            <SettingsEmpty
              hint={t("apps.settingsNoPluginsHint")}
              icon={<Blocks />}
              title={t("apps.settingsNoPlugins")}
            />
          ) : (
            <SettingsList>
              {extensions?.requirements.map((item) => (
                <PluginRow item={item} key={item.declaredComponentIdentity} />
              ))}
              {/* 全局插件页是渲染层自己的路由常量：从前这里读 capability 快照
                  里的同名字段，而那条 IPC 属于 Tools 页——为一个字符串多发一
                  条请求，还让本页的挂载依赖另一页的数据。 */}
              <SettingsLinkRow
                description={t("apps.settingsOpenGlobalPluginsHint")}
                label={t("apps.settingsOpenGlobalPlugins")}
                onSelect={() => {
                  onClose();
                  void navigate("/settings/extensions");
                }}
              />
            </SettingsList>
          )}
        </SettingsSection>

        {/* 两颗动作各自成行，不再是浮在版面右下的一对按钮：主次由「有没有
            说明」表达，而说明得有地方写。 */}
        {Boolean(extensions?.requirements.length) && (
          <SettingsSection title={t("apps.settingsPluginGrantSection")}>
            <SettingsList>
              <SettingsRow
                htmlFor="app-plugin-revoke"
                label={t("apps.settingsRevokeGeneration")}
                description={t("apps.settingsRevokeGenerationHint")}
                control={
                  <SettingsButton
                    disabled={busy}
                    id="app-plugin-revoke"
                    onClick={() => {
                      void run(
                        () => revokeAppExtensionGrant(record.id),
                        t("apps.settingsPluginRevokeFailed")
                      ).then((next) => { if (next) setExtensions(next); });
                    }}
                    variant="outline"
                  >
                    {t("apps.settingsRevokeAction")}
                  </SettingsButton>
                }
              />
              <SettingsRow
                htmlFor="app-plugin-rebuild"
                label={t("apps.settingsRebuildGeneration")}
                description={t("apps.settingsRebuildGenerationHint")}
                control={
                  <SettingsButton
                    disabled={busy || Boolean(record.generationBinding.pending)}
                    id="app-plugin-rebuild"
                    onClick={() => {
                      void run(
                        () => rebuildAppExtensionGeneration(record.id),
                        t("apps.settingsPluginRebuildFailed")
                      ).then((next) => { if (next !== undefined) onClose(); });
                    }}
                  >
                    <RefreshCw />
                    {t("apps.settingsRebuildAction")}
                  </SettingsButton>
                }
              />
            </SettingsList>
          </SettingsSection>
        )}
      </div>
    </SettingsCanvas>
  );
}

/* 从前这一行是 `installed true · enabled enabled · grant granted · generation
   current`——一条裸调试串上了产品界面：中英夹杂、四个键值对连成一行，用户
   读不懂，也就无从判断该不该点上面那两颗按钮。四个字段各自成为一枚徽标，
   语义交给 SettingsBadge 的档位，不再交给分隔符。 */
function PluginRow({ item }: { item: AppExtensionRequirementStatus }) {
  const { t } = useAppTranslation();
  const grantKey = {
    granted: "apps.settingsPluginGranted",
    missing: "apps.settingsPluginGrantMissing",
    revoked: "apps.settingsPluginGrantRevoked",
    "not-applicable": null,
  }[item.grant.state];
  return (
    <SettingsRow
      badge={
        <SettingsBadge tone="muted">
          {t(item.required ? "apps.requirementRequired" : "apps.requirementOptional")}
        </SettingsBadge>
      }
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <SettingsBadge tone={item.installed ? "neutral" : "warn"}>
            {t(item.installed ? "apps.settingsPluginInstalled" : "apps.settingsPluginNotInstalled")}
          </SettingsBadge>
          <SettingsBadge tone={item.enabled === "yes" ? "neutral" : "muted"}>
            {t(
              item.enabled === "yes"
                ? "apps.settingsPluginEnabled"
                : item.enabled === "no"
                  ? "apps.settingsPluginDisabled"
                  : "apps.settingsPluginEnabledPending"
            )}
          </SettingsBadge>
          {grantKey && (
            <SettingsBadge tone={item.grant.state === "granted" ? "neutral" : "warn"}>
              {t(grantKey)}
            </SettingsBadge>
          )}
          {item.generationState !== "active" && (
            <SettingsBadge tone="warn">
              {t("apps.settingsPluginGenerationStale")}
            </SettingsBadge>
          )}
        </span>
      }
      label={item.declaredComponentIdentity}
      control={null}
    />
  );
}
