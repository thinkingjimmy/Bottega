/**
 * [INPUT]: Depends on React external-store, i18n, settingsStore, ui/Tabs and settings-layout
 * [OUTPUT]: Provides 26 ambient built-in tools for seven-domain page switches and renderer data sets
 * [POS]: The built-in tool controls for Settings › Tools; No import zod-backed spec, lists synchronized by Node testing
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@ai-chat/ui/components/ui/tabs";
import {
  SettingsRow,
  SettingsSection,
  SettingsSurface,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings-store";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export type BuiltinToolCopy = Readonly<{
  domain: "Sections" | "Subagents" | "Projects" | "Bases" | "Search" | "Browser" | "Apps";
}>;

export const BUILTIN_TOOL_COPY = {
  list_sections: { domain: "Sections" },
  read_section: { domain: "Sections" },
  send_to_section: { domain: "Sections" },
  create_section: { domain: "Sections" },
  promote_result_to_section: { domain: "Sections" },
  export_attachment: { domain: "Sections" },
  spawn_subagent: { domain: "Subagents" },
  convert_chat_to_project: { domain: "Projects" },
  base_describe: { domain: "Bases" },
  base_query: { domain: "Bases" },
  read_base: { domain: "Bases" },
  base_export_csv: { domain: "Bases" },
  base_set_view: { domain: "Bases" },
  base_update_columns: { domain: "Bases" },
  base_add_columns: { domain: "Bases" },
  base_insert_rows: { domain: "Bases" },
  base_patch_rows: { domain: "Bases" },
  base_delete_rows: { domain: "Bases" },
  search_chat_history: { domain: "Search" },
  search_bases: { domain: "Search" },
  browser_open: { domain: "Browser" },
  browser_snapshot: { domain: "Browser" },
  browser_act: { domain: "Browser" },
  browser_tabs: { domain: "Browser" },
  browser_close: { domain: "Browser" },
  validate_app: { domain: "Apps" },
} as const satisfies Record<string, BuiltinToolCopy>;

const DOMAIN_ORDER: readonly BuiltinToolCopy["domain"][] = [
  "Sections",
  "Subagents",
  "Projects",
  "Bases",
  "Search",
  "Browser",
  "Apps",
];

const DOMAIN_KEYS: Record<BuiltinToolCopy["domain"], string> = {
  Sections: "sections",
  Subagents: "subagents",
  Projects: "projects",
  Bases: "bases",
  Search: "search",
  Browser: "browser",
  Apps: "apps",
};

/* 分域只是清单的一种读法，与设置状态无关：索引在模块求值时建一次，
   渲染期就没有「每帧把 26 项过七遍」这回事，也不必在 JSX 里嵌 filter。 */
const DOMAINS = DOMAIN_ORDER.map((domain) => ({
  domain,
  tools: Object.entries(BUILTIN_TOOL_COPY).filter(
    ([, copy]) => copy.domain === domain
  ),
}));

export function BuiltinToolsSection() {
  const { t } = useAppTranslation();
  const snapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => settingsStore.ensureLoaded(), []);
  const disabled = new Set(snapshot.settings?.disabledBuiltinTools ?? []);

  const toggle = async (name: string, enabled: boolean) => {
    setPending((current) => new Set(current).add(name));
    await settingsStore.update(
      (current) => ({
        disabledBuiltinTools: enabled
          ? current.disabledBuiltinTools.filter((item) => item !== name)
          : [...new Set([...current.disabledBuiltinTools, name])],
      }),
      t("settings.tools.builtin.saveFailed")
    );
    setPending((current) => {
      const next = new Set(current);
      next.delete(name);
      return next;
    });
  };

  return (
    <SettingsSection
      title={t("settings.tools.builtin.title")}
      description={t("settings.tools.builtin.description")}
    >
      {/* ── 七域从平铺改成页签 ──────────────────────────────────────
          26 项 7 组平铺约 2.4 屏，是这一页唯一「读到底才算读完」的长尾：
          它把同页另外那段挤到折叠线以下，而它自己也没因此好读——没人
          真的从 Sections 一路滚到 Apps，人只想看自己此刻关心的那一域。

          页签把「翻多少」换成「选哪个」，代价是把不在当前页的状态藏了
          起来：在 Sections 页上关掉的三项 Browser 工具，从此没有任何
          痕迹。所以关闭计数必须长在页签上——藏起来的是行，不是事实。
          页签于是同时是导航和一张总览，而不只是省版面的折叠。 */}
      <Tabs defaultValue={DOMAINS[0]?.domain}>
        {/* 页签即这张卡的表头：一条 SettingsSurface 把页签条与下面的开关行收进
            同一张卡，页签底缘那道线就是表头分隔——不再是裸页签浮在另一张卡之上。
            line 变体让它与 Personalization / Usage 顶部同一种下划线页签。 */}
        <SettingsSurface>
          <TabsList
            variant="line"
            className="w-full items-stretch justify-start gap-0 rounded-none border-b border-border bg-transparent p-0 px-2 group-data-horizontal/tabs:h-auto"
          >
            {DOMAINS.map(({ domain, tools }) => {
              const off = tools.filter(([name]) => disabled.has(name)).length;
              return (
                <TabsTrigger
                  key={domain}
                  value={domain}
                  className="h-auto flex-none cursor-pointer gap-1.5 rounded-none px-3.5 py-2.5 text-sm group-data-horizontal/tabs:after:bottom-[-1px]"
                >
                {t(`settings.tools.builtin.domain.${DOMAIN_KEYS[domain]}`)}
                {off > 0 && (
                  <>
                    <span
                      aria-hidden="true"
                      className="rounded-full bg-foreground/10 px-1 font-medium text-[10px] tabular-nums"
                    >
                      {off}
                    </span>
                    {/* 数字在读屏里念作孤零零的「3」，语义得自己带上：
                        页签的可及名于是是「Browser，3 项已关闭」。 */}
                    <span className="sr-only">
                      {t("settings.tools.builtin.disabledCount", {
                        count: off,
                      })}
                    </span>
                  </>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {DOMAINS.map(({ domain, tools }) => (
          <TabsContent key={domain} value={domain}>
            <div className="divide-y divide-border">
              {tools.map(([name]) => {
                const label = t(
                  `settings.tools.builtin.items.${name}.label`
                );
                return (
                <SettingsRow
                  control={
                    <SettingsSwitch
                      checked={!disabled.has(name)}
                      disabled={!snapshot.settings || pending.has(name)}
                      id={`builtin-tool-${name}`}
                      /* 状态由 aria-checked 播报，标签再说一次「已开启」
                         就成了「列出 Sections 已开启, 开关, 开」。 */
                      label={label}
                      onToggle={(enabled) => void toggle(name, enabled)}
                    />
                  }
                  description={
                    <>
                      {t(`settings.tools.builtin.items.${name}.hint`)}{" "}
                      {/* 工具名是标识符不是散文：同字号同色排在句末，
                          想按名字找一个工具就只能逐句读过去。 */}
                      <code className="font-mono text-[11px] text-muted-foreground/70">
                        {name}
                      </code>
                    </>
                  }
                  htmlFor={`builtin-tool-${name}`}
                  key={name}
                  label={label}
                />
                );
              })}
            </div>
          </TabsContent>
        ))}
        </SettingsSurface>
      </Tabs>
    </SettingsSection>
  );
}
