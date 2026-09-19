/**
 * [INPUT]: Depends on React, Appearance/I18n/Setup providers, AgentFailureNotice, PresenceSettings, ArchiveConfettiRow, shared SettingsPreferenceSelect, settings controls/store, PageShell, and UI primitives.
 * [OUTPUT]: Provides GeneralSettingsView/ThemeSelect/LanguageSelect/CrossChatReadToggle/TitleAgentLabel with appearance, presence, Chat Home, and single-backend title generation settings using consistent trigger/menu typography.
 * [POS]: Settings layer's default view; holds no settings snapshot of its own — subscribes to settingsStore and pulls the per-backend model catalog on demand
 */

import { SettingsPreferenceSelect } from "@ai-chat/ui/components/settings/preference-select";
import { PresenceSettings } from "@/components/settings/presence/section";
import { ArchiveConfettiRow } from "@/components/settings/general/archive-confetti-row";
import { FolderProgress } from "@/components/settings/general/folder-progress";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAppearance } from "@/components/providers/appearance-provider";
import { useSetup } from "@/components/providers/setup-provider";
import {
  useAppTranslation,
  useSystemFileManagerRevealLabel,
} from "@/components/providers/i18n-provider";
import {
  SettingsCanvas,
  SettingsButton,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { PageShell } from "@/components/page-shell";
import { AgentFailureNotice } from "@/components/agent-failure-notice";
import { FolderOpen, RefreshCw, Settings } from "lucide-react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { FontFamily } from "@/lib/appearance";
import {
  AgentBackendIcon,
  backendLabel,
  titleAgentNotice,
  titleAgentOptions,
} from "@/lib/agent-backends";
import {
  buildTitleModelOptions,
  persistedTitleModelValue,
  selectedTitleModelValue,
} from "@/lib/settings-client";
import { settingsStore } from "@/lib/settings-store";
import type { AppSettings, ThemePreference } from "../../shared/settings-ipc";
import type { LanguagePreference } from "@ai-chat/ui/lib/locale";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type BackendInfo,
  type BackendModelInfo,
} from "../../shared/agent-ipc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";

const THEME_OPTIONS: Array<{ labelKey: string; value: ThemePreference }> = [
  { labelKey: "common.auto", value: "auto" },
  { labelKey: "common.light", value: "light" },
  { labelKey: "common.dark", value: "dark" },
];

export const LANGUAGE_OPTIONS: Array<{
  emoji: string;
  label?: string;
  labelKey?: "settings.general.autoDetect";
  value: LanguagePreference;
}> = [
  { emoji: "🌐", labelKey: "settings.general.autoDetect", value: "auto" },
  { emoji: "🇨🇳", label: "简体中文", value: "zh-CN" },
  { emoji: "🇺🇸", label: "English", value: "en" },
  { emoji: "🇯🇵", label: "日本語", value: "ja" },
  { emoji: "🇫🇷", label: "Français", value: "fr" },
  { emoji: "🇪🇸", label: "Español", value: "es" },
];

const FONT_OPTIONS: Array<{
  label?: string;
  labelKey?: "settings.general.systemFont";
  value: FontFamily;
}> = [
  { labelKey: "settings.general.systemFont", value: "system" },
  { label: "Maple Mono NF-CN", value: "maple-mono" },
  { label: "Geist Sans", value: "geist-sans" },
];

/* 稳定空目录引用：目录未就绪时避免逐 render 新建数组击穿 useMemo */
const NO_MODELS: BackendModelInfo[] = [];

/* 四个后端恒在列且恒可选：标题失败会回落到用户自己的第一句话，所以
 * 「装没装、登没登」是一条提示，不是一道把选项藏起来的门。 */
export function TitleAgentLabel({
  value,
  notice,
}: {
  value: AgentBackendId;
  notice?: ReturnType<typeof titleAgentNotice>;
}) {
  const { t } = useAppTranslation();
  return (
    <span className="flex items-center gap-1.5">
      <AgentBackendIcon backend={value} className="size-3.5" />
      {backendLabel(value)}
      {notice ? (
        <span className="text-muted-foreground">
          {t(`agentAvailability.state.${notice}`)}
        </span>
      ) : null}
    </span>
  );
}

/* ============================================================
 * Chat 分组的两行只有在真值到达后才存在：settings 非空是它的
 * 入参前提，于是内部一个判空分支都不需要。
 * ============================================================ */

function ChatRows({
  settings,
  backends,
  now,
  modelsByBackend,
  modelsReadyByBackend,
}: {
  settings: AppSettings;
  backends: BackendInfo[] | undefined;
  now: number;
  modelsByBackend: Partial<Record<AgentBackendId, BackendModelInfo[]>>;
  modelsReadyByBackend: Partial<Record<AgentBackendId, boolean>>;
}) {
  const { t } = useAppTranslation();
  /* 模型槽位按后端各存一份，选择器编辑的始终是当前标题 Agent 自己的那一格。 */
  const titleAgent = settings.titleAgent;
  const agentOptions = useMemo(
    () => titleAgentOptions(backends, now),
    [backends, now],
  );
  useEffect(() => {
    settingsStore.ensureModels(titleAgent);
  }, [titleAgent]);

  const models = modelsByBackend[titleAgent] ?? NO_MODELS;
  const modelsReady = modelsReadyByBackend[titleAgent] ?? false;
  const titleModel =
    settings.titleModelByBackend[titleAgent] ?? null;
  const modelOptions = useMemo(
    () =>
      buildTitleModelOptions(models, titleModel, {
        defaultModelUnavailable: t("settings.general.defaultModelUnavailable"),
        currentModelUnavailable: (model) =>
          t("settings.general.currentModelUnavailable", { model }),
      }),
    [models, titleModel, t],
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
          [titleAgent]: persistedTitleModelValue(value, models),
        },
      },
      t("settings.general.saveTitleModelFailed"),
    );

  const selectTitleAgent = (value: string) =>
    settingsStore.update(
      { titleAgent: value as AgentBackendId },
      t("settings.general.saveTitleAgentFailed"),
    );

  const selectAutoRelayLimit = (value: string) => {
    const autoRelayLimit = Number(value);
    if (!Number.isSafeInteger(autoRelayLimit)) return;
    void settingsStore.update(
      { autoRelayLimit },
      t("settings.general.saveRelayLimitFailed"),
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
            <SelectContent align="end" className="text-sm">
              {[5, 10, 25, 50, 100, 0].map((value) => (
                <SelectItem key={value} value={String(value)}>
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
                  <TitleAgentLabel
                    value={titleAgent}
                    notice={
                      agentOptions.find((option) => option.id === titleAgent)
                        ?.notice
                    }
                  />
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="text-sm">
                {agentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    <TitleAgentLabel
                      value={option.id}
                      notice={option.notice}
                    />
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
                  {modelsReady
                    ? selectedModelLabel
                    : t("settings.general.reading")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end" className="text-sm">
                {modelOptions.map((model) => (
                  <SelectItem key={model.value} value={model.value}>
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
        <div
          key={row}
          className="flex items-center justify-between gap-6 px-4 py-3"
        >
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

export function CrossChatReadToggle({ enabled }: { enabled: boolean }) {
  const { t } = useAppTranslation();
  return (
    <SettingsSwitch
      id="allow-cross-chat-read"
      label={t("settings.general.crossChatRead")}
      checked={enabled}
      onToggle={(allowCrossChatRead) =>
        void settingsStore.update(
          { allowCrossChatRead },
          t("settings.general.saveCrossChatReadFailed"),
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
        t("settings.general.saveThemeFailed"),
      );
    }
  };
  return (
    <SettingsPreferenceSelect
      id="theme-preference"
      label={t("settings.general.theme")}
      value={theme}
      onValueChange={selectTheme}
      options={THEME_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      }))}
    />
  );
}

export function LanguageSelect({
  language,
}: {
  language: LanguagePreference | null;
}) {
  const { t } = useAppTranslation();
  if (!language) return <Skeleton className="h-8 w-48 shrink-0" />;
  return (
    <SettingsPreferenceSelect
      id="language-preference"
      label={t("settings.general.language")}
      value={language}
      options={LANGUAGE_OPTIONS.map((option) => ({
        value: option.value,
        emoji: option.emoji,
        label: option.labelKey ? t(option.labelKey) : option.label!,
      }))}
      onValueChange={(value) => {
        const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
        if (option)
          void settingsStore.update(
            { language: option.value },
            t("settings.general.saveLanguageFailed"),
          );
      }}
    />
  );
}

export function GeneralSettingsView() {
  const { t } = useAppTranslation();
  const revealLabel = useSystemFileManagerRevealLabel();
  const [revealError, setRevealError] = useState("");
  const { appearance, updateAppearance } = useAppearance();
  const setup = useSetup();
  const {
    settings,
    modelsByBackend,
    modelsReadyByBackend,
    error,
    modelsErrorByBackend,
    chatHomesRootError,
    folderProgress,
  } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const backends = setup.status?.backends;
  const titleAgent = settings?.titleAgent ?? AGENT_BACKEND_ORDER[0];
  const modelsError = modelsErrorByBackend[titleAgent] ?? null;

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
                control={
                  <LanguageSelect language={settings?.language ?? null} />
                }
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
                    <SelectContent align="end" className="text-sm">
                      {FONT_OPTIONS.map((font) => (
                        <SelectItem key={font.value} value={font.value}>
                          {font.labelKey ? t(font.labelKey) : font.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              <ArchiveConfettiRow />
            </SettingsList>
          </SettingsSection>

          <PresenceSettings />

          <SettingsSection
            title={t("settings.general.chatHomeLocation")}
            description={t("settings.general.chatHomeDescription")}
            alert={revealError || chatHomesRootError || error}
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
            <FolderProgress progress={folderProgress} />
            <SettingsList>
              <SettingsRow
                label={t("settings.general.folder")}
                htmlFor="choose-chat-homes-root"
                description={
                  settings ? (
                    <span className="font-mono text-xs break-all">
                      {settings.chatHomesRoot ??
                        t("settings.general.notSelected")}
                    </span>
                  ) : (
                    <Skeleton className="h-3 w-72" />
                  )
                }
                control={
                  <SettingsButton
                    aria-label={revealLabel}
                    id="choose-chat-homes-root"
                    variant="outline"
                    disabled={!settings?.chatHomesRoot}
                    onClick={() => {
                      setRevealError("");
                      void window.settings
                        ?.revealLibrary?.()
                        .catch((cause) => setRevealError(String(cause)));
                    }}
                  >
                    <FolderOpen className="size-3.5" />
                    {revealLabel}
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
            action={
              modelsError && settings ? (
                <SettingsButton
                  variant="outline"
                  onClick={() =>
                    settingsStore.retryModels(titleAgent)
                  }
                >
                  {t("settings.general.modelDirectoryRetry")}
                </SettingsButton>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {modelsError && <AgentFailureNotice compact {...modelsError} />}
              {settings ? (
                <ChatRows
                  settings={settings}
                  backends={backends}
                  now={setup.now}
                  modelsByBackend={modelsByBackend}
                  modelsReadyByBackend={modelsReadyByBackend}
                />
              ) : (
                <ChatRowsSkeleton />
              )}
            </div>
          </SettingsSection>
        </div>
      </SettingsCanvas>
    </PageShell>
  );
}
