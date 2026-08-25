"use client";

/**
 * [INPUT]: Depends on the configuration/ability/plugin/three-mode authorization API of the Apps/Setup Provider/app client, AppSidePanel and Tabs
 * [OUTPUT]: Provides AppSettingsPanel; Unified carrying general, tools, Agent plugins and authorized four stable settings
 * [POS]: The third layer of App details for components/apps; Web/Base shared, open to main current checks, geometry and resize to AppSidePanel
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Blocks, RefreshCw, ShieldOff, Wrench } from "lucide-react";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  SettingsButton,
  SettingsEmpty,
} from "@/components/settings/settings-layout";
import { useApps } from "@/components/providers/apps-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import {
  listAppGrantSources,
  readAppCapabilities,
  readAppConfig,
  readAppExtensionStatus,
  rebuildAppExtensionGeneration,
  revokeAppBaseGuiAccess,
  revokeAppExtensionGrant,
  writeAppConfig,
} from "@/lib/apps-client";
import type {
  AppCapabilitiesSnapshot,
  AppConfigValue,
  AppExtensionStatus,
  AppGrantSource,
  AppRecord,
} from "../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { AgentSelect } from "./agent-select";
import { AppGrantsPanel } from "./app-grants-panel";
import { AppRequirementsForm, appRequirementsSatisfied } from "./app-requirements-form";
import { AppSidePanel } from "./app-side-panel";

const EMPTY_CONFIG: AppConfigValue = { values: {}, agentReadableKeys: [] };

/* 外壳常驻布局（关闭态是零宽 flex 兄弟），内容只在开栏时挂载——设置面消费
   Apps/Setup/Projects 三个 Provider，栏关着还去碰它们，等于让「没打开的面板」
   对宿主提出依赖。分栏与内容因此必须分家，与 AppEditPanelShell 同一条法。 */
export function AppSettingsPanel({ record, open, onClose }: {
  record: AppRecord;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();

  return (
    <AppSidePanel
      closeLabel={t("apps.settingsCollapse")}
      /* 标题落在页头基线上，四个 tab 紧随其下。原本那句「通用配置、实时能力、
         Agent 插件和作用域授权」正是这四个 tab 的逐字复述，随 Sheet 一并退场。 */
      header={
        <p className="min-w-0 flex-1 truncate px-2 font-medium text-sm">
          {t("apps.settingsTitle", { name: record.displayName })}
        </p>
      }
      onClose={onClose}
      open={open}
      railLabel={t("apps.settingsResize")}
    >
      <AppSettingsBody onClose={onClose} record={record} />
    </AppSidePanel>
  );
}

function AppSettingsBody({ record, onClose }: {
  record: AppRecord;
  onClose: () => void;
}) {
  const { renameApp, setAgent } = useApps();
  const { t } = useAppTranslation();
  const setup = useSetup();
  const navigate = useNavigate();
  const { projects } = useProjects();
  const requirements = record.manifest?.requirements?.tools ?? [];
  const [name, setName] = useState(record.displayName);
  const [config, setConfig] = useState<AppConfigValue>(EMPTY_CONFIG);
  const [capabilities, setCapabilities] = useState<AppCapabilitiesSnapshot | null>(null);
  const [extensions, setExtensions] = useState<AppExtensionStatus | null>(null);
  const [sources, setSources] = useState<AppGrantSource[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 挂载即开栏，故无需再问一次「开了吗」——那个分支已随组件边界消失。
  useEffect(() => {
    let active = true;
    Promise.all([
      readAppConfig(record.id),
      readAppCapabilities(record.id),
      readAppExtensionStatus(record.id),
      listAppGrantSources(),
    ]).then(([nextConfig, nextCapabilities, nextExtensions, nextSources]) => {
      if (!active) return;
      setName(record.displayName);
      setConfig(nextConfig);
      setCapabilities(nextCapabilities);
      setExtensions(nextExtensions);
      setSources([...nextSources.chats, ...nextSources.projects, ...nextSources.globals].filter((item) => item.appId === record.id));
      setError("");
    }).catch((cause) => active && setError(errorMessage(cause, t("apps.settingsReadFailed"))));
    return () => { active = false; };
  }, [record.id, record.displayName, revision, t]);

  const saveGeneral = async () => {
    setBusy(true);
    setError("");
    try {
      await Promise.all([
        renameApp({ appId: record.id, name: name.trim() }),
        writeAppConfig(record.id, config),
      ]);
    } catch (cause) {
      setError(errorMessage(cause, t("apps.settingsSaveFailed")));
    } finally {
      setBusy(false);
    }
  };

  const toolsEmpty = Boolean(
    capabilities &&
    capabilities.tools.length === 0 &&
    capabilities.agentTools.skills.length === 0 &&
    capabilities.agentTools.mcpServers.length === 0
  );

  const updateAgent = async (role: "interactive" | "maintenance", agent: AgentBackendId | "auto") => {
    setBusy(true);
    try {
      await setAgent({ appId: record.id, role, agent });
    } catch (cause) {
      setError(errorMessage(cause, t("apps.settingsAgentFailed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col px-4 pt-3">
      {/* 错误横幅在滚动区之外：滚下去看不见的错误等于没报错。 */}
      {error && <p className="mb-3 shrink-0 rounded-lg bg-destructive/10 p-3 text-destructive text-sm" role="alert">{error}</p>}
      <Tabs className="flex min-h-0 flex-1 flex-col" defaultValue="general">
        <TabsList className="w-full shrink-0">
          <TabsTrigger value="general">{t("apps.settingsGeneral")}</TabsTrigger>
          <TabsTrigger value="tools">{t("common.tools")}</TabsTrigger>
          <TabsTrigger value="plugins">{t("common.agentPlugins")}</TabsTrigger>
          <TabsTrigger value="grants">{t("apps.grants")}</TabsTrigger>
        </TabsList>
        <SlimScroller className="min-h-0 flex-1 overflow-y-auto pb-8">
          {/* 组内 8px、组间 24px：3:1 才读得出「这个标题管着下面那个控件」。
              之前是 6/8px 对 20px，两级差距不足，四个控件糊成一片。
              标题一律用真 <label htmlFor>，点标题即聚焦控件。 */}
          <TabsContent className="space-y-6" value="general">
            <div className="space-y-2">
              <label className="block font-medium text-sm" htmlFor="app-settings-name">{t("apps.settingsName")}</label>
              <Input disabled={busy} id="app-settings-name" maxLength={120} onChange={(event) => setName(event.target.value)} value={name} />
            </div>
            {requirements.length > 0 && <AppRequirementsForm disabled={busy} onChange={setConfig} requirements={requirements} value={config} />}
            <div className="space-y-2">
              <span className="block font-medium text-sm" id="settings-interactive-agent">{t("apps.settingsInteractiveAgent")}</span>
              <AgentSelect disabled={busy} labelledBy="settings-interactive-agent" onChange={(value) => void updateAgent("interactive", value as AgentBackendId)} options={setup.status?.backends ?? []} value={record.agent} />
            </div>
            <div className="space-y-2">
              <span className="block font-medium text-sm" id="settings-maintenance-agent">{t("apps.settingsMaintenanceAgent")}</span>
              <AgentSelect allowAuto disabled={busy} labelledBy="settings-maintenance-agent" onChange={(value) => void updateAgent("maintenance", value)} options={maintenanceCapableBackends(setup.status?.backends ?? [])} value={record.maintenanceAgent} />
            </div>
            {/* 提交动作靠右：表单的出口在右下角，与弹窗页脚同一条肌肉记忆 */}
            <div className="flex justify-end">
              <SettingsButton disabled={busy || !name.trim() || !appRequirementsSatisfied(requirements, config)} onClick={() => void saveGeneral()}>{t("apps.settingsSave")}</SettingsButton>
            </div>
          </TabsContent>
          <TabsContent className="space-y-3" value="tools">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">{t("apps.settingsLiveSnapshot")}</p>
              <SettingsButton onClick={() => setRevision((value) => value + 1)} variant="outline"><RefreshCw />{t("apps.settingsRedetect")}</SettingsButton>
            </div>
            {/* 空态判据是三个来源同时为空。旧版只看 tools.length，于是「没有额外
                工具」会印在一串 Skill/MCP 之上——一句当场被下文推翻的判词。 */}
            {toolsEmpty ? (
              <SettingsEmpty hint={t("apps.settingsNoToolsHint")} icon={<Wrench />} title={t("apps.settingsNoTools")} />
            ) : (
              <>
                {capabilities?.tools.map((item) => <div className="rounded-lg border p-3" key={item.requirement.id}><div className="flex justify-between gap-3 text-sm"><span>{item.requirement.label}</span><span className="text-muted-foreground">{item.status}</span></div>{item.guidance && <p className="mt-1 text-muted-foreground text-xs">{item.guidance}</p>}</div>)}
                {capabilities?.agentTools.skills.map((item) => <div className="rounded-lg border p-3 text-sm" key={`skill:${item.name}`}>{t("apps.settingsAgentToolState", { kind: "Skill", name: item.name, state: item.health })}</div>)}
                {capabilities?.agentTools.mcpServers.map((item) => <div className="rounded-lg border p-3 text-sm" key={`mcp:${item.name}`}>{t("apps.settingsAgentToolState", { kind: "MCP", name: item.name, state: item.health })}</div>)}
              </>
            )}
            {/* 去全局页是本 tab 的出口，不是它的第一件事：动作行落在内容之后、
                靠右，与保存同一条边。 */}
            <div className="flex justify-end">
              <SettingsButton onClick={() => { onClose(); void navigate(capabilities?.settings.toolsPath ?? "/settings/tools"); }} variant="ghost">{t("apps.settingsOpenGlobalTools")}</SettingsButton>
            </div>
          </TabsContent>
          <TabsContent className="space-y-3" value="plugins">
            {extensions && extensions.requirements.length === 0 ? (
              <SettingsEmpty hint={t("apps.settingsNoPluginsHint")} icon={<Blocks />} title={t("apps.settingsNoPlugins")} />
            ) : (
              <>
                {extensions?.requirements.map((item) => <div className="rounded-lg border p-3 text-sm" key={item.componentIdentity}><p className="font-mono text-xs">{item.componentIdentity}</p><p className="mt-1 text-muted-foreground text-xs">{t("apps.settingsPluginState", { installed: String(item.installed), enabled: item.enabled, grant: item.grant.state, generation: item.generationState })}</p></div>)}
                {extensions && extensions.requirements.length > 0 && <div className="flex flex-wrap justify-end gap-2"><SettingsButton disabled={busy} onClick={() => { setBusy(true); void revokeAppExtensionGrant(record.id).then(setExtensions).catch((cause) => setError(errorMessage(cause, t("apps.settingsPluginRevokeFailed")))).finally(() => setBusy(false)); }} variant="outline"><ShieldOff />{t("apps.settingsRevokeGeneration")}</SettingsButton><SettingsButton disabled={busy || Boolean(record.generationBinding.pending)} onClick={() => { setBusy(true); void rebuildAppExtensionGeneration(record.id).then(onClose).catch((cause) => setError(errorMessage(cause, t("apps.settingsPluginRebuildFailed")))).finally(() => setBusy(false)); }}><RefreshCw />{t("apps.settingsRebuildGeneration")}</SettingsButton></div>}
              </>
            )}
            <div className="flex justify-end">
              <SettingsButton onClick={() => { onClose(); void navigate(capabilities?.settings.extensionsPath ?? "/settings/extensions"); }} variant="ghost">{t("apps.settingsOpenGlobalPlugins")}</SettingsButton>
            </div>
          </TabsContent>
          <TabsContent className="space-y-4" value="grants">
            {Boolean(capabilities?.baseGuiCapability.requested.length) && (
              <section className="space-y-2 rounded-lg border p-3">
                <p className="font-medium text-sm">
                  {t("apps.settingsBaseGuiAccessTitle")}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("apps.settingsBaseGuiAccessDescription")}
                </p>
                {Boolean(capabilities?.baseGuiCapability.effective.length) && (
                  <div className="flex justify-end">
                    <SettingsButton
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void revokeAppBaseGuiAccess(record.id)
                          .then(() => setRevision((value) => value + 1))
                          .catch((cause) =>
                            setError(
                              errorMessage(
                                cause,
                                t("apps.settingsBaseGuiRevokeFailed")
                              )
                            )
                          )
                          .finally(() => setBusy(false));
                      }}
                      variant="outline"
                    >
                      <ShieldOff />
                      {t("apps.settingsRevokeBaseGuiAccess")}
                    </SettingsButton>
                  </div>
                )}
              </section>
            )}
            <AppGrantsPanel
              onChanged={() => setRevision((value) => value + 1)}
              onError={(cause) => setError(errorMessage(cause, t("apps.settingsDefaultFailed")))}
              projects={projects}
              record={record}
              sources={sources}
            />
          </TabsContent>
      </SlimScroller>
    </Tabs>
    </div>
  );
}
