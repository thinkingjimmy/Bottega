"use client";

/**
 * [INPUT]: Depends on the Apps/Setup providers, apps-client capability/extension/grant commands, AppSidePanel, Tabs, SidebarRenameDialog, and Settings primitives
 * [OUTPUT]: Provides AppSettingsPanel; four stable tabs (General, Tools, Agent plugins, Grants) rendered in the same vocabulary as Project Settings, with Studio access status and revocation among the capability rows
 * [POS]: The third-layer App detail of components/apps; open to main current checks, geometry and resize delegated to AppSidePanel
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Blocks, Pencil, RefreshCw, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import {
  SettingsAlert,
  SettingsBadge,
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsLinkRow,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { SidebarRenameDialog } from "@/components/sidebar/rename/sidebar-rename-dialog";
import { useApps } from "@/components/providers/apps-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
import { maintenanceCapableBackends } from "@/lib/agent-backends";
import {
  listAppGrantSources,
  readAppCapabilities,
  readAppConfig,
  readAppExtensionStatus,
  rebuildAppExtensionGeneration,
  revokeAppStudioAccess,
  revokeAppExtensionGrant,
  writeAppConfig,
} from "@/lib/apps-client";
import type {
  AppCapabilitiesSnapshot,
  AppConfigValue,
  AppExtensionRequirementStatus,
  AppExtensionStatus,
  AppGrantSource,
  AppRecord,
} from "../../../shared/apps-ipc";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { AgentSelect } from "./agent-select";
import { AppGrantsPanel } from "./app-grants-panel";
import { AppRequirementsForm, appRequirementsSatisfied } from "./app-requirements-form";
import { AppSidePanel } from "./app-side-panel";
import { DesignDangerSection } from "./design/design-data-settings";

const EMPTY_CONFIG: AppConfigValue = { values: {}, agentReadableKeys: [] };
const TABS = ["general", "tools", "plugins", "grants"] as const;

/* ============================================================
 * 外壳常驻布局（关闭态是零宽 flex 兄弟），内容只在开栏时挂载——设置面消费
 * Apps/Setup/Projects 三个 Provider，栏关着还去碰它们，等于让「没打开的面板」
 * 对宿主提出依赖。分栏与内容因此必须分家，由 AppSidePanel 统一守住挂载边界。
 *
 * Tabs 升到 AppSidePanel 之外，与 Project Settings 把 Tabs 升到 PageShell
 * 之外是同一件事：页签条要交给外壳当第二层页头，而 TabsList 与 TabsContent
 * 必须同处一个 Tabs 之下。外层用 `contents` 而非 flex——这一层只为把
 * Radix 的上下文送进去，不该在栏与宿主之间多插一个盒子，否则宽度、
 * shrink-0 与 resize 全落在错误的元素上。
 * ============================================================ */
export function AppSettingsPanel({ record, open, onClose }: {
  record: AppRecord;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();

  return (
    <Tabs className="contents" defaultValue="general">
      <AppSidePanel
        closeLabel={t("apps.settingsCollapse")}
        /* 标题落在页头基线上，页签条紧随其下自成一层。原本那句「通用配置、
           实时能力、Agent 插件和作用域授权」正是这四个 tab 的逐字复述，
           随 Sheet 一并退场。 */
        header={
          <p className="min-w-0 flex-1 truncate px-2 font-medium text-sm">
            {t("apps.settingsTitle", { name: record.displayName })}
          </p>
        }
        onClose={onClose}
        open={open}
        rail={
          /* h-10 与页头等高：两行 40px 读成一个页头块，而不是页头下面吊了
             一条窄带。

             pl-3 = SettingsCanvas 的 24 减去触发器自带的 px-3。要压在内容
             左边界上的是页签的**字**，不是页签的盒子：从前写 px-6 对齐的是
             盒子，字被触发器的内边距又推出去 12，于是它既不与标题齐、也不与
             内容齐，只是自己占着第三条边。

             选中态那条下划线仍从 12 起，且本该如此——它压在整幅分界线上，是
             那条线的加粗段，不是内容列的成员（见 tabs.tsx 里 -bottom-px 那段）。 */
          <TabsList
            className="w-fit pl-3 pr-6 group-data-horizontal/tabs:h-10"
            variant="line"
          >
            {TABS.map((value) => (
              <TabsTrigger className="cursor-pointer px-3" key={value} value={value}>
                {t(TAB_LABEL_KEY[value])}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        railLabel={t("apps.settingsResize")}
      >
        <AppSettingsBody onClose={onClose} record={record} />
      </AppSidePanel>
    </Tabs>
  );
}

const TAB_LABEL_KEY = {
  general: "apps.settingsGeneral",
  tools: "common.tools",
  plugins: "common.agentPlugins",
  grants: "apps.grants",
} as const;

function AppSettingsBody({ record, onClose }: {
  record: AppRecord;
  onClose: () => void;
}) {
  const { renameApp, setAgent } = useApps();
  const { t } = useAppTranslation();
  const setup = useSetup();
  const navigate = useNavigate();
  const requirements = record.manifest?.requirements?.tools ?? [];
  const [config, setConfig] = useState<AppConfigValue>(EMPTY_CONFIG);
  const [capabilities, setCapabilities] = useState<AppCapabilitiesSnapshot | null>(null);
  const [extensions, setExtensions] = useState<AppExtensionStatus | null>(null);
  const [sources, setSources] = useState<AppGrantSource[]>([]);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
      setConfig(nextConfig);
      setCapabilities(nextCapabilities);
      setExtensions(nextExtensions);
      setSources([...nextSources.chats, ...nextSources.projects, ...nextSources.globals].filter((item) => item.appId === record.id));
      setError("");
    }).catch((cause) => active && setError(errorMessage(cause, t("apps.settingsReadFailed"))));
    return () => { active = false; };
    /* 依赖收敛到实际读取的原始字段,而非整个 record:apps-provider 每来一条 status
       事件就换 record 对象引用,若以 record 为依赖,本 effect 会重发 4 条 IPC。 */
  }, [record.id, revision, t]);

  const fail = (cause: unknown, fallbackKey: string) =>
    setError(errorMessage(cause, t(fallbackKey)));

  /* 名称走弹窗后，这颗保存只剩机器配置一件事可管——而配置是唯一还需要
     「先填完再提交」的东西。其余控件一律即时生效，与 Project Settings 和
     侧栏六页设置一致：一个页面里两种提交模型，用户没法知道哪些要按。 */
  const saveConfig = async () => {
    setBusy(true);
    setError("");
    try {
      await writeAppConfig(record.id, config);
    } catch (cause) {
      fail(cause, "apps.settingsSaveFailed");
    } finally {
      setBusy(false);
    }
  };

  const updateAgent = async (role: "interactive" | "maintenance", agent: AgentBackendId | "auto") => {
    setBusy(true);
    try {
      await setAgent({ appId: record.id, role, agent });
    } catch (cause) {
      fail(cause, "apps.settingsAgentFailed");
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

  return (
    <div className="flex h-full flex-col">
      {/* 错误横幅在滚动区之外：滚下去看不见的错误等于没报错。 */}
      {error && (
        <div className="shrink-0 px-6 pt-4">
          <SettingsAlert>{error}</SettingsAlert>
        </div>
      )}

      <TabsContent className="min-h-0 flex-1" value="general">
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
                      onChange={(value) => void updateAgent("interactive", value as AgentBackendId)}
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
                      onChange={(value) => void updateAgent("maintenance", value)}
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
                {/* 提交动作靠右：表单的出口在右下角，与弹窗页脚同一条肌肉记忆 */}
                <div className="flex justify-end">
                  <SettingsButton
                    disabled={busy || !appRequirementsSatisfied(requirements, config)}
                    onClick={() => void saveConfig()}
                  >
                    {t("apps.settingsSave")}
                  </SettingsButton>
                </div>
              </SettingsSection>
            )}

            {/* 危险区坐末位，手要多走一段才够得着它。段落自己判断有没有话说。 */}
            {record.presetId === "design-canvas" && (
              <DesignDangerSection
                onError={(cause) => fail(cause, "apps.settingsSaveFailed")}
                record={record}
              />
            )}
          </div>
        </SettingsCanvas>
      </TabsContent>

      <TabsContent className="min-h-0 flex-1" value="tools">
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
            {/* 空态判据是三个来源同时为空。旧版只看 tools.length，于是「没有额外
                工具」会印在一串 Skill/MCP 之上——一句当场被下文推翻的判词。 */}
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
      </TabsContent>

      <TabsContent className="min-h-0 flex-1" value="plugins">
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
                  <SettingsLinkRow
                    description={t("apps.settingsOpenGlobalPluginsHint")}
                    label={t("apps.settingsOpenGlobalPlugins")}
                    onSelect={() => {
                      onClose();
                      void navigate(capabilities?.settings.extensionsPath ?? "/settings/extensions");
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
                          setBusy(true);
                          void revokeAppExtensionGrant(record.id)
                            .then(setExtensions)
                            .catch((cause) => fail(cause, "apps.settingsPluginRevokeFailed"))
                            .finally(() => setBusy(false));
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
                          setBusy(true);
                          void rebuildAppExtensionGeneration(record.id)
                            .then(onClose)
                            .catch((cause) => fail(cause, "apps.settingsPluginRebuildFailed"))
                            .finally(() => setBusy(false));
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
      </TabsContent>

      <TabsContent className="min-h-0 flex-1" value="grants">
        <SettingsCanvas>
          <AppGrantsPanel
            onChanged={() => setRevision((value) => value + 1)}
            onError={(cause) => fail(cause, "apps.settingsDefaultFailed")}
            onRevokeStudio={() => {
              setBusy(true);
              void revokeAppStudioAccess(record.id)
                .then(() => setRevision((value) => value + 1))
                .catch((cause) => fail(cause, "apps.settingsStudioRevokeFailed"))
                .finally(() => setBusy(false));
            }}
            record={record}
            sources={sources}
          />
        </SettingsCanvas>
      </TabsContent>

      <SidebarRenameDialog
        currentName={record.displayName}
        description={t("apps.settingsRenameDescription")}
        maxLength={120}
        onOpenChange={setRenaming}
        onRename={(name) => renameApp({ appId: record.id, name })}
        open={renaming}
        title={t("apps.settingsRenameTitle")}
      />
    </div>
  );
}

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

/* 从前这一行是 `installed true · enabled enabled · grant granted · generation
   current`——一条裸调试串上了产品界面：中英夹杂、四个键值对连成一行，用户
   读不懂，也就无从判断该不该点下面那两颗按钮。四个字段各自成为一枚徽标，
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
