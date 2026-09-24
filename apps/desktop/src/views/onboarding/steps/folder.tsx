/**
 * [INPUT]: Settings folder selection and materialization progress, the Settings list primitives and SetupRowTile.
 * [OUTPUT]: FolderStep renders the single Bottega folder row and advances only after the selected library finishes opening.
 * [POS]: Onboarding required data-location step body inside OnboardingFrame.
 */
import { Folder } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { FolderProgress } from "@/components/settings/general/folder-progress";
import { SettingsAlert, SettingsBadge, SettingsButton, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { SetupRowTile } from "@/components/setup/row-tile";
import { settingsStore } from "@/lib/settings-store";

export function FolderStep({ onSelected }: { onSelected: () => void }) {
  const { t } = useAppTranslation();
  const { settings, error, chatHomesRootBusy, chatHomesRootError, folderProgress } =
    useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const state = settings?.chatHomeState ?? "unconfigured";
  const chosen = Boolean(settings?.chatHomesRoot);
  useEffect(() => { if (chosen && state === "ready") onSelected(); }, [chosen, state, onSelected]);
  /* Choosing a folder and reopening the already-chosen one are two entry points
     into the same thing: both auto-advance on success. A folder that's already
     been chosen never shows the folder picker again — changing folders isn't
     supported here, and doing so would just trade one failure for another. */
  const openFolder = async () => {
    const opened = await (chosen
      ? settingsStore.retryLibrary()
      : settingsStore.chooseChatHomesRoot());
    if (opened) onSelected();
  };
  const control = error ? (
    <SettingsButton variant="outline" onClick={settingsStore.retrySettings}>{t("common.retry")}</SettingsButton>
  ) : !chosen || state !== "ready" ? (
    <SettingsButton variant="outline" disabled={chatHomesRootBusy || !settings} onClick={() => void openFolder()}>
      {chatHomesRootBusy && <Spinner className="size-3.5" />}
      {t(chatHomesRootBusy ? "onboarding.opening" : chosen ? "common.retry" : "onboarding.choose")}
    </SettingsButton>
  ) : null;
  /* The path's identity is its tail: truncating would eat the only part a reader recognizes, so it wraps instead. */
  const description = !settings ? <Skeleton className="mt-1 h-3 w-64 max-w-full" />
    : settings.chatHomesRoot ? <span className="line-clamp-2 break-all font-mono text-[11.5px] text-foreground" title={settings.chatHomesRoot}>{settings.chatHomesRoot}</span>
      : t("onboarding.chatHomeUnset");

  return (
    <>
      <SettingsList>
        <SettingsRow
          leading={<SetupRowTile className="bg-blue-500/10 text-blue-600 dark:text-blue-400"><Folder className="size-[18px]" strokeWidth={1.75} /></SetupRowTile>}
          label={t("onboarding.folder", { product: PRODUCT_NAME })}
          badge={settings && (!chosen || state === "ready") && <SettingsBadge tone={state === "ready" ? "neutral" : "muted"}>{t(`onboarding.chatHome.${state}`)}</SettingsBadge>}
          description={description}
          control={control}
        />
      </SettingsList>
      <FolderProgress progress={folderProgress} />
      {(error || chatHomesRootError) && <SettingsAlert>{chatHomesRootError || error}</SettingsAlert>}
    </>
  );
}
