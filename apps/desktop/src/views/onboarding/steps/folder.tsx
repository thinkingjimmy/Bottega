/**
 * [INPUT]: Settings folder selection, the onboarding folder suggestion and materialization progress, DialogChoice, OnboardingActions and the Settings alert.
 * [OUTPUT]: FolderStep — the suggested folder (Start fresh at the first free home-level name, or Continue where you left off at a found Bottega folder) and Choose a folder… as one radio group with Continue; a configured folder that failed to open retries in place. It advances only after the library finishes opening.
 * [POS]: Onboarding required data-location step body inside OnboardingFrame.
 */
import { Folder, FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { DialogChoice } from "@ai-chat/ui/components/ui/app-dialog";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { PRODUCT_NAME } from "@ai-chat/ui/components/workspace/brand";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { FolderProgress } from "@/components/settings/general/folder-progress";
import { SettingsAlert, SettingsButton } from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings/store/settings-store";
import type { LibrarySuggestion } from "../../../../shared/ipc/settings/settings-ipc";
import { OnboardingActions } from "../frame";

type Choice = "suggested" | "choose";

/* The path's identity is its tail; `~` keeps it short enough that it never needs truncating. */
const Path = ({ suggestion }: { suggestion: LibrarySuggestion }) =>
  <span className="font-mono text-[12.5px] text-foreground/80">~/{suggestion.name}</span>;

/** "{{path}}" swapped for the path element, so the mono path sits inside translated prose. */
function withPath(text: string, path: ReactNode) {
  const [before, after = ""] = text.split("\u0000");
  return <>{before}{path}{after}</>;
}

export function FolderStep({ onSelected }: { onSelected: () => void }) {
  const { t } = useAppTranslation();
  const { settings, error, chatHomesRootBusy, chatHomesRootError, folderProgress } =
    useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const chosen = Boolean(settings?.chatHomesRoot);
  const ready = chosen && settings?.chatHomeState === "ready";
  useEffect(() => { if (ready) onSelected(); }, [ready, onSelected]);

  /* undefined while asking; null when no home-level name is free, which leaves the chooser as the only way. */
  const [suggestion, setSuggestion] = useState<LibrarySuggestion | null | undefined>(undefined);
  const [choice, setChoice] = useState<Choice>("suggested");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (chosen) return;
    let live = true;
    void settingsStore.suggestChatHomesRoot().then(
      (next) => { if (live) setSuggestion(next); },
      () => { if (live) setSuggestion(null); }
    );
    return () => { live = false; };
  }, [chosen, attempt]);
  const selected: Choice = suggestion ? choice : "choose";

  /* A folder that's already been chosen never shows the choices again — changing folders isn't
     supported here, and doing so would just trade one failure for another. */
  const open = async () => {
    const opened = chosen ? await settingsStore.retryLibrary()
      : selected === "suggested" && suggestion ? await settingsStore.openSuggestedChatHomesRoot(suggestion.path)
        : await settingsStore.chooseChatHomesRoot();
    if (opened) onSelected();
    /* The folder at the suggested name may have changed since it was offered; offer again from what is there now. */
    else if (!chosen) setAttempt((value) => value + 1);
  };

  const alert = (error || chatHomesRootError) && <SettingsAlert>{chatHomesRootError || error}</SettingsAlert>;
  const continueButton = (label: string) => (
    <SettingsButton disabled={chatHomesRootBusy || !settings || suggestion === undefined && !chosen} onClick={() => void open()}>
      {chatHomesRootBusy && <Spinner className="size-3.5" />}
      {chatHomesRootBusy ? t("onboarding.opening") : label}
    </SettingsButton>
  );

  if (error) {
    return <>
      {alert}
      <OnboardingActions><span className="flex-1" />
        <SettingsButton onClick={settingsStore.retrySettings}>{t("common.retry")}</SettingsButton>
      </OnboardingActions>
    </>;
  }
  if (chosen) {
    return <>
      <p className="break-all font-mono text-[12.5px] text-foreground/80" title={settings?.chatHomesRoot ?? undefined}>{settings?.chatHomesRoot}</p>
      <FolderProgress progress={folderProgress} />
      {alert}
      {!ready && <OnboardingActions><span className="flex-1" />{continueButton(t("common.retry"))}</OnboardingActions>}
    </>;
  }

  const path = suggestion ? <Path suggestion={suggestion} /> : null;
  const found = suggestion?.kind === "found";
  return <>
    <div role="radiogroup" aria-label={t("onboarding.folder.aria")} className="flex flex-col gap-2">
      {suggestion === undefined ? <Skeleton className="h-[62px] w-full rounded-md" />
        : suggestion && <DialogChoice
          role="radio" aria-checked={selected === "suggested"} selected={selected === "suggested"}
          icon={found ? <FolderOpen /> : <FolderPlus />}
          title={t(found ? "onboarding.folder.found" : "onboarding.folder.fresh")}
          badge={t(found ? "onboarding.folder.foundBadge" : "onboarding.folder.recommended")}
          detail={withPath(t(found ? "onboarding.folder.foundDetail" : "onboarding.folder.freshDetail", { path: "\u0000", product: PRODUCT_NAME }), path)}
          disabled={chatHomesRootBusy}
          onClick={() => setChoice("suggested")}
        />}
      <DialogChoice
        role="radio" aria-checked={selected === "choose"} selected={selected === "choose"}
        icon={<Folder />}
        title={t("onboarding.folder.choose")}
        detail={t("onboarding.folder.chooseDetail", { product: PRODUCT_NAME })}
        disabled={chatHomesRootBusy}
        onClick={() => setChoice("choose")}
      />
    </div>
    <FolderProgress progress={folderProgress} />
    {alert}
    <OnboardingActions><span className="flex-1" />{continueButton(t("onboarding.next"))}</OnboardingActions>
  </>;
}
