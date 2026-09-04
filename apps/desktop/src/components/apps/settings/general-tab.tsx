"use client";

/**
 * [INPUT]: Depends on the Apps/Setup providers, App config read/write IPC, AgentSelect, AppRequirementsForm, SidebarRenameDialog, the Design danger section, and Settings primitives
 * [OUTPUT]: Provides GeneralTab — identity, the two Agent roles, machine configuration, and the Design danger zone
 * [POS]: The first body of components/apps/settings; it reads App config and nothing else, so opening another tab costs no IPC here
 */

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { SidebarRenameDialog } from "@/components/sidebar/rename/sidebar-rename-dialog";
import { useApps } from "@/components/providers/apps-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import { readAppConfig, writeAppConfig } from "@/lib/apps-client";
import type { AppConfigValue } from "../../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../../shared/agent-ipc";
import { AgentSelect } from "../install/agent-select";
import {
  AppRequirementsForm,
  appRequirementsSatisfied,
} from "../install/app-requirements-form";
import { DesignDangerSection } from "../design/design-data-settings";
import type { AppSettingsTabProps } from "./tab-shell";

const EMPTY_CONFIG: AppConfigValue = { values: {}, agentReadableKeys: [] };

export function GeneralTab({ record, busy, fail, run }: AppSettingsTabProps) {
  const { renameApp, setAgent } = useApps();
  const { t } = useAppTranslation();
  const setup = useSetup();
  const requirements = record.manifest?.requirements?.tools ?? [];
  const [config, setConfig] = useState<AppConfigValue>(EMPTY_CONFIG);
  const [renaming, setRenaming] = useState(false);

  /* 依赖收敛到 appId：apps-provider 每来一条 status 事件就换 record 对象引用，
     若以 record 为依赖，这条 effect 会随生命周期抖动反复重读配置。 */
  useEffect(() => {
    let active = true;
    void readAppConfig(record.id)
      .then((next) => { if (active) setConfig(next); })
      .catch((cause) => { if (active) fail(cause, t("apps.settingsReadFailed")); });
    return () => { active = false; };
  }, [fail, record.id, t]);

  const updateAgent = (
    role: "interactive" | "maintenance",
    agent: AgentBackendId | "auto"
  ) => void run(
    () => setAgent({ appId: record.id, role, agent }),
    t("apps.settingsAgentFailed")
  );

  return (
    <SettingsCanvas>
      <div className="space-y-8">
        <SettingsSection title={t("apps.settingsBasics")}>
          <SettingsList>
            {/* 身份行与 ProjectIdentityRow 同形：名字是被展示的事实，
                改名是一次明确的动作，故走弹窗而不是常驻输入框。面板里
                因此没有一个占满宽度的表单控件——表面的环与控件边框
                平行等距时，它就不再是容器，只是一圈没有职责的描边。 */}
            <div className="flex items-center justify-between gap-6 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border text-base"
                >
                  {record.manifest?.icon ?? "📦"}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{record.displayName}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t("apps.settingsNameAndIcon")}
                  </p>
                </div>
              </div>
              <SettingsButton
                disabled={busy}
                onClick={() => setRenaming(true)}
                variant="outline"
              >
                <Pencil />
                {t("apps.settingsRename")}
              </SettingsButton>
            </div>
            <SettingsRow
              label={t("apps.settingsInteractiveAgent")}
              description={t("apps.settingsInteractiveAgentHint")}
              control={
                <AgentSelect
                  className="w-fit"
                  disabled={busy}
                  label={t("apps.settingsInteractiveAgent")}
                  onChange={(value) => updateAgent("interactive", value as AgentBackendId)}
                  options={setup.status?.backends ?? []}
                  size="lg"
                  value={record.agent}
                />
              }
            />
            <SettingsRow
              label={t("apps.settingsMaintenanceAgent")}
              description={t("apps.settingsMaintenanceAgentHint")}
              control={
                <AgentSelect
                  allowAuto
                  className="w-fit"
                  disabled={busy}
                  label={t("apps.settingsMaintenanceAgent")}
                  onChange={(value) => updateAgent("maintenance", value)}
                  options={maintenanceCapableBackends(setup.status?.backends ?? [])}
                  size="lg"
                  value={record.maintenanceAgent}
                />
              }
            />
          </SettingsList>
        </SettingsSection>

        {requirements.length > 0 && (
          <SettingsSection title={t("apps.settingsRequirements")}>
            <SettingsSurface className="p-4">
              <AppRequirementsForm
                disabled={busy}
                onChange={setConfig}
                requirements={requirements}
                value={config}
              />
            </SettingsSurface>
            {/* 提交动作靠右：表单的出口在右下角，与弹窗页脚同一条肌肉记忆。
                机器配置是这一页唯一还需要「先填完再提交」的东西，其余控件
                一律即时生效——一个页面里两种提交模型，用户没法知道哪些要按。 */}
            <div className="flex justify-end">
              <SettingsButton
                disabled={busy || !appRequirementsSatisfied(requirements, config)}
                onClick={() => void run(
                  () => writeAppConfig(record.id, config),
                  t("apps.settingsSaveFailed")
                )}
              >
                {t("apps.settingsSave")}
              </SettingsButton>
            </div>
          </SettingsSection>
        )}

        {/* 危险区坐末位，手要多走一段才够得着它。段落自己判断有没有话说。 */}
        {record.presetId === "design-canvas" && (
          <DesignDangerSection
            onError={(cause) => fail(cause, t("apps.settingsSaveFailed"))}
            record={record}
          />
        )}
      </div>

      <SidebarRenameDialog
        currentName={record.displayName}
        description={t("apps.settingsRenameDescription")}
        maxLength={120}
        onOpenChange={setRenaming}
        onRename={(name) => renameApp({ appId: record.id, name })}
        open={renaming}
        title={t("apps.settingsRenameTitle")}
      />
    </SettingsCanvas>
  );
}
