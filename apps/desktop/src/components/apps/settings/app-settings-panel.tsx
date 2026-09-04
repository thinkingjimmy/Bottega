"use client";

/**
 * [INPUT]: Depends on the shared AppRecordProjection read model, AppSidePanel, Tabs, the settings tab bodies, and the shared busy/error shell
 * [OUTPUT]: Provides AppSettingsPanel; four stable tabs (General, Tools, Agent plugins, Grants) rendered in the same vocabulary as Project Settings, each owning its own reads
 * [POS]: The third-column chrome of components/apps/settings; the shell and the error banner live here, every IPC lives in the tab that shows its result
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import { SettingsAlert } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { AppRecordProjection } from "../../../../shared/apps-ipc";
import { AppSidePanel } from "../app-side-panel";
import { GeneralTab } from "./general-tab";
import { GrantsTab } from "./grants-tab";
import { PluginsTab } from "./plugins-tab";
import { ToolsTab } from "./tools-tab";
import { useAppSettingsShell } from "./tab-shell";

const TABS = ["general", "tools", "plugins", "grants"] as const;

const TAB_LABEL_KEY = {
  general: "apps.settingsGeneral",
  tools: "common.tools",
  plugins: "common.agentPlugins",
  grants: "apps.grants",
} as const;

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
  record: AppRecordProjection;
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

/* Radix 只挂当前那一个 TabsContent，所以「页签自持取数」等于「打开哪一页
   才发哪一条 IPC」——从前四条 IPC 在挂载时一起发，另外三条读回来的东西
   没有任何人看，而任何一次 revision 变动会把四条再发一遍。 */
function AppSettingsBody({ record, onClose }: {
  record: AppRecordProjection;
  onClose: () => void;
}) {
  const { busy, error, fail, run } = useAppSettingsShell();
  const tab = { busy, fail, onClose, record, run };

  return (
    <div className="flex h-full flex-col">
      {/* 错误横幅在滚动区之外：滚下去看不见的错误等于没报错。 */}
      {error && (
        <div className="shrink-0 px-6 pt-4">
          <SettingsAlert>{error}</SettingsAlert>
        </div>
      )}

      <TabsContent className="min-h-0 flex-1" value="general">
        <GeneralTab {...tab} />
      </TabsContent>
      <TabsContent className="min-h-0 flex-1" value="tools">
        <ToolsTab {...tab} />
      </TabsContent>
      <TabsContent className="min-h-0 flex-1" value="plugins">
        <PluginsTab {...tab} />
      </TabsContent>
      <TabsContent className="min-h-0 flex-1" value="grants">
        <GrantsTab {...tab} />
      </TabsContent>
    </div>
  );
}
