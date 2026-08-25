/**
 * [INPUT]: Depends on React, Appearance/I18n/Setup Provider, settings-layout, settingsStore, PageShell and ui/select/skeleton/spinner
 * [OUTPUT]: Provides GeneralSettingsView/ThemeSelect/LanguageSelect/CrossChatReadToggle, with the settings for the Theme/Language, Font, chat Home and title generation that are permanently fixed
 * [POS]: Settings: the default view of the layer of coverage; The condition is not loaded so you can't hold the set snapshot, subscribe to the settingsStore and pull the model directory that is isolated at the back end as needed
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAppearance } from "@/components/providers/appearance-provider";
import { useSetup } from "@/components/providers/setup-provider";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsCanvas,
  SettingsButton,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { PageShell } from "@/components/page-shell";
import { FolderOpen, RefreshCw, Settings, Sparkles } from "lucide-react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import type { FontFamily } from "@/lib/appearance";
import {
  AgentBackendIcon,
  backendLabel,
  effectiveTitleAgent,
  titleAgentOptions,
} from "@/lib/agent-backends";
import {
  buildTitleModelOptions,
  hasSettingsBridge,
  persistedTitleModelValue,
  selectedTitleModelValue,
} from "@/lib/settings-client";
import { settingsStore } from "@/lib/settings-store";
import type { AppSettings, ThemePreference } from "../../shared/settings-ipc";
import type { LanguagePreference } from "../../shared/i18n/locale";
import type {
  AgentBackendId,
  BackendModelInfo,
} from "../../shared/agent-ipc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";

const THEME_OPTIONS: Array<{ key: string; value: ThemePreference }> = [
  { key: "common.auto", value: "auto" },
  { key: "common.light", value: "light" },
  { key: "common.dark", value: "dark" },
];

export const LANGUAGE_OPTIONS: Array<{
  emoji: string;
  label: string;
  value: LanguagePreference;
}> = [
  { emoji: "🌐", label: "Auto detect", value: "auto" },
  { emoji: "🇨🇳", label: "简体中文", value: "zh-CN" },
  { emoji: "🇺🇸", label: "English", value: "en" },
  { emoji: "🇯🇵", label: "日本語", value: "ja" },
  { emoji: "🇫🇷", label: "Français", value: "fr" },
  { emoji: "🇪🇸", label: "Español", value: "es" },
];

function LanguageLabel({ option }: { option: (typeof LANGUAGE_OPTIONS)[number] }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="w-5 text-center text-base leading-none">
        {option.emoji}
      </span>
      <span>{option.label}</span>
    </span>
  );
}

const FONT_OPTIONS: Array<{ label: string; value: FontFamily }> = [
  { label: "System", value: "system" },
  { label: "Maple Mono NF-CN", value: "maple-mono" },
  { label: "Geist Sans", value: "geist-sans" },
];

/* 稳定空目录引用：目录未就绪时避免逐 render 新建数组击穿 useMemo */
const NO_MODELS: BackendModelInfo[] = [];

/** 标题模型槽位归属：Auto（含失效回落）编辑 Codex 槽位，显式选择编辑自己的。 */
const titleSlot = (titleAgent: AppSettings["titleAgent"]): AgentBackendId =>
  titleAgent === "auto" ? "codex" : titleAgent;

/** 标题 Agent 的显示身份：Auto 用 Sparkles，其余复用后端品牌 logo。 */
function TitleAgentLabel({ value }: { value: AppSettings["titleAgent"] }) {
  const { t } = useAppTranslation();
  return (
    <span className="flex items-center gap-1.5">
      {value === "auto" ? (
        <>
          <Sparkles className="size-3.5" />
          {t("common.auto")}
        </>
      ) : (
        <>
          <AgentBackendIcon backend={value} className="size-3.5" />
          {backendLabel(value)}
        </>
      )}
    </span>
  );
}

/* ============================================================
 * Chat 分组的两行只有在真值到达后才存在：settings 非空是它的
 * 入参前提，于是内部一个判空分支都不需要。
 * ============================================================ */

function ChatRows({
  settings,
  titleAgent,
  titleAgentOptions,
  modelsByBackend,
  modelsReadyByBackend,
}: {
  settings: AppSettings;
  titleAgent: AppSettings["titleAgent"];
  titleAgentOptions: Array<AppSettings["titleAgent"]>;
  modelsByBackend: Partial<Record<AgentBackendId, BackendModelInfo[]>>;
  modelsReadyByBackend: Partial<Record<AgentBackendId, boolean>>;
}) {
  const { t } = useAppTranslation();
  /* Auto 生成期优先 Codex，故选择器编辑 Codex 槽位；生成期若降级
   * 到其他后端，会使用该后端自己记忆的槽位（默认 CLI 默认模型）。 */
  const effectiveTitleBackend = titleSlot(titleAgent);
  useEffect(() => {
    settingsStore.ensureModels(effectiveTitleBackend);
  }, [effectiveTitleBackend]);

  const models = modelsByBackend[effectiveTitleBackend] ?? NO_MODELS;
  const modelsReady = modelsReadyByBackend[effectiveTitleBackend] ?? false;
  const titleModel =
    settings.titleModelByBackend[effectiveTitleBackend] ?? null;
  const modelOptions = useMemo(
    () =>
      buildTitleModelOptions(models, titleModel, {
        defaultModelUnavailable: t("settings.general.defaultModelUnavailable"),
        currentModelUnavailable: (model) =>
          t("settings.general.currentModelUnavailable", { model }),
      }),
    [models, titleModel, t]
  );
  const selectedModelValue = selectedTitleModelValue(titleModel, models);
  const selectedModelLabel =
    modelOptions.find((model) => model.value === selectedModelValue)?.label ??
    t("settings.general.defaultModelUnavailable");

  const selectTitleModel = (value: string) =>
    settingsStore.update(
      {
        titleModelByBackend: {
          ...settings.titleModelByBackend,
          [effectiveTitleBackend]: persistedTitleModelValue(value, models),
        },
      },
      t("settings.general.saveTitleModelFailed")
    );

  const selectTitleAgent = (value: string) =>
    settingsStore.update(
      { titleAgent: value === "auto" ? "auto" : (value as AgentBackendId) },
      t("settings.general.saveTitleAgentFailed")
    );

  const selectAutoRelayLimit = (value: string) => {
    const autoRelayLimit = Number(value);
    if (!Number.isSafeInteger(autoRelayLimit)) return;
    void settingsStore.update(
      { autoRelayLimit },
      t("settings.general.saveRelayLimitFailed")
    );
  };

  return (
    <SettingsList>
      <SettingsRow
        label={t("settings.general.autoRelayLimit")}
        htmlFor="auto-relay-limit"
        description={
          settings.autoRelayLimit === 0
            ? t("settings.general.autoRelayRisk")
            : t("settings.general.autoRelayDescription")
        }
        control={
          <Select
            value={String(settings.autoRelayLimit)}
            onValueChange={selectAutoRelayLimit}
          >
            <SelectTrigger
              id="auto-relay-limit"
              aria-label={t("settings.general.autoRelayLimit")}
              size="lg"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {[5, 10, 25, 50, 100, 0].map((value) => (
                <SelectItem
                  key={value}
                  value={String(value)}

                >
                  {value === 0
                    ? t("settings.general.unlimitedNotRecommended")
                    : t("settings.general.rounds", { count: value })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {/* Agent 与 model 是一个复合值：agent 决定 model 选择器编辑
       * 哪个后端的槽位，因此并置为同一行，让联动由布局本身表达。 */}
      <SettingsRow
        label={t("settings.general.titleGeneration")}
        htmlFor="title-agent"
        description={t("settings.general.titleGenerationDescription")}
        control={
          <div className="flex items-center gap-2">
            <Select
              value={titleAgent}
              onValueChange={(value) => void selectTitleAgent(value)}
            >
              <SelectTrigger
                id="title-agent"
                aria-label={t("settings.general.titleAgent")}
                size="lg"
              >
                <SelectValue>
                  <TitleAgentLabel value={titleAgent} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {titleAgentOptions.map((option) => (
                  <SelectItem
                    key={option}
                    value={option}

                  >
                    <TitleAgentLabel value={option} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedModelValue}
              onValueChange={(value) => void selectTitleModel(value)}
              disabled={!modelsReady}
            >
              <SelectTrigger
                id="title-model"
                aria-label={t("settings.general.titleModel")}
                size="lg"
              >
                <SelectValue>
                  {modelsReady ? selectedModelLabel : t("settings.general.reading")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                {modelOptions.map((model) => (
                  <SelectItem
                    key={model.value}
                    value={model.value}

                  >
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
    </SettingsList>
  );
}

function ChatRowsSkeleton() {
  return (
    <SettingsList data-testid="settings-chat-skeleton">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-center justify-between gap-6 px-4 py-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-8 w-44 shrink-0" />
        </div>
      ))}
    </SettingsList>
  );
}

export function CrossChatReadToggle({
  enabled,
  disabled,
}: {
  enabled: boolean;
  disabled: boolean;
}) {
  const { t } = useAppTranslation();
  return (
    <SettingsSwitch
      id="allow-cross-chat-read"
      label={t("settings.general.crossChatRead")}
      checked={enabled}
      disabled={disabled}
      onToggle={(allowCrossChatRead) =>
        void settingsStore.update(
          { allowCrossChatRead },
          t("settings.general.saveCrossChatReadFailed")
        )
      }
    />
  );
}

/* 与 Font 同区不同家：Font 只有 renderer 一个消费者，Theme 还要在建窗前
   被 main 读到，故走 settingsStore 落盘——快照未到即先占位。 */
export function ThemeSelect({ theme }: { theme: ThemePreference | null }) {
  const { t } = useAppTranslation();
  if (!theme) return <Skeleton className="h-8 w-48 shrink-0" />;
  const selectTheme = (value: string) => {
    const option = THEME_OPTIONS.find((entry) => entry.value === value);
    if (option) {
      void settingsStore.update(
        { theme: option.value },
        t("settings.general.saveThemeFailed")
      );
    }
  };
  return (
    <Select value={theme} onValueChange={selectTheme}>
      <SelectTrigger
        id="theme-preference"
        aria-label={t("settings.general.theme")}
        size="lg"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {THEME_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}

          >
            {t(option.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LanguageSelect({
  language,
}: {
  language: LanguagePreference | null;
}) {
  const { t } = useAppTranslation();
  if (!language) return <Skeleton className="h-8 w-48 shrink-0" />;
  const selected =
    LANGUAGE_OPTIONS.find((option) => option.value === language) ??
    LANGUAGE_OPTIONS[0];
  return (
    <Select
      value={language}
      onValueChange={(value) => {
        const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
        if (option) {
          void settingsStore.update(
            { language: option.value },
            t("settings.general.saveLanguageFailed")
          );
        }
      }}
    >
      <SelectTrigger
        id="language-preference"
        aria-label={t("settings.general.language")}
        size="lg"
      >
        <SelectValue>
          <LanguageLabel option={selected} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" className="min-w-48">
        {LANGUAGE_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="min-h-9 pr-9 text-sm"
          >
            <LanguageLabel option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function GeneralSettingsView() {
  const { t } = useAppTranslation();
  const { appearance, updateAppearance } = useAppearance();
  const setup = useSetup();
  const {
    settings,
    modelsByBackend,
    modelsReadyByBackend,
    error,
    modelsErrorByBackend,
    chatHomesRootBusy,
    chatHomesRootError,
  } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  /* 候选不是常量，是能力的函数；失效的持久值只在呈现上回落，
     判据与回落规则同住 lib/agent-backends 以便单测。 */
  const backends = setup.status?.backends;
  const options = useMemo(() => titleAgentOptions(backends), [backends]);
  const titleAgent = effectiveTitleAgent(settings?.titleAgent, backends);
  const effectiveTitleBackend = titleSlot(titleAgent);
  const modelsError = modelsErrorByBackend[effectiveTitleBackend] ?? "";

  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);

  const selectFont = (value: string) => {
    const option = FONT_OPTIONS.find((font) => font.value === value);
    if (option) updateAppearance({ fontFamily: option.value });
  };

  return (
    <PageShell title={t("common.general")} icon={<Settings />}>
      <SettingsCanvas>
        <div className="space-y-8">

          <SettingsSection title={t("settings.general.appearance")}>
            <SettingsList>
              <SettingsRow
                label={t("settings.general.theme")}
                htmlFor="theme-preference"
                description={t("settings.general.themeDescription")}
                control={<ThemeSelect theme={settings?.theme ?? null} />}
              />
              <SettingsRow
                label={t("settings.general.language")}
                htmlFor="language-preference"
                description={t("settings.general.languageDescription")}
                control={<LanguageSelect language={settings?.language ?? null} />}
              />
              <SettingsRow
                label={t("settings.general.font")}
                htmlFor="font-family"
                description={t("settings.general.fontDescription")}
                control={
                  <Select
                    value={appearance.fontFamily}
                    onValueChange={selectFont}
                  >
                    <SelectTrigger
                      id="font-family"
                      aria-label={t("settings.general.font")}
                      size="lg"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {FONT_OPTIONS.map((font) => (
                        <SelectItem
                          key={font.value}
                          value={font.value}

                        >
                          {font.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsList>
          </SettingsSection>

          <SettingsSection
            title={t("settings.general.chatHomeLocation")}
            description={t("settings.general.chatHomeDescription")}
            alert={chatHomesRootError || error}
            action={
              error ? (
                <SettingsButton
                  variant="outline"
                  onClick={settingsStore.retrySettings}
                >
                  <RefreshCw />
                  {t("settings.general.settingsRetry")}
                </SettingsButton>
              ) : undefined
            }
          >
            <SettingsList>
              <SettingsRow
                label={t("settings.general.folder")}
                htmlFor="choose-chat-homes-root"
                description={
                  settings ? (
                    <span className="font-mono text-xs break-all">
                      {settings.chatHomesRoot ?? t("settings.general.notSelected")}
                    </span>
                  ) : (
                    <Skeleton className="h-3 w-72" />
                  )
                }
                control={
                  <SettingsButton
                    /* SettingsRow 的 `<label for>` 优先级高于按钮自身文本，
                     * 于是它对外自称「文件夹」而屏幕上写着「更改…」——可见名不在
                     * 可访问名之内（WCAG 2.5.3），语音控制念屏幕上那三个字反而点不动它。
                     * aria-label 盖过 label 元素，把可见文案接回名字，行标题降为上下文。 */
                    aria-label={t("settings.general.changeChatHomeFolder")}
                    id="choose-chat-homes-root"
                    variant="outline"
                    disabled={
                      chatHomesRootBusy ||
                      !settings ||
                      !hasSettingsBridge()
                    }
                    onClick={() => void settingsStore.chooseChatHomesRoot()}
                  >
                    {chatHomesRootBusy ? (
                      <Spinner className="size-3.5" />
                    ) : (
                      <FolderOpen className="size-3.5" />
                    )}
                    {t("settings.general.change")}
                  </SettingsButton>
                }
              />
              <SettingsRow
                label={t("settings.general.crossChatRead")}
                htmlFor="allow-cross-chat-read"
                description={t("settings.general.crossChatReadDescription")}
                control={
                  settings ? (
                    <CrossChatReadToggle
                      enabled={settings.allowCrossChatRead}
                      disabled={!hasSettingsBridge()}
                    />
                  ) : (
                    <Skeleton className="h-6 w-11 rounded-full" />
                  )
                }
              />
            </SettingsList>
          </SettingsSection>

          <SettingsSection
            title={t("settings.general.chat")}
            description={t("settings.general.chatDescription")}
            alert={modelsError}
            action={
              modelsError && settings ? (
                <SettingsButton
                  variant="outline"
                  onClick={() => settingsStore.retryModels(effectiveTitleBackend)}
                >
                  {t("settings.general.modelDirectoryRetry")}
                </SettingsButton>
              ) : undefined
            }
          >
            {settings ? (
              <ChatRows
                settings={settings}
                titleAgent={titleAgent}
                titleAgentOptions={options}
                modelsByBackend={modelsByBackend}
                modelsReadyByBackend={modelsReadyByBackend}
              />
            ) : (
              <ChatRowsSkeleton />
            )}
          </SettingsSection>
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
