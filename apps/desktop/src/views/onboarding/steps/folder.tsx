/**
 * [INPUT]: Settings folder selection and materialization progress.
 * [OUTPUT]: FolderStep advances only after the selected library finishes opening.
 * [POS]: Onboarding required data-location step.
 */
import { FolderOpen } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { FolderProgress } from "@/components/settings/general/folder-progress";
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
     supported, and doing so would just trade one failure for another. */
  const openFolder = async () => {
    const opened = await (chosen
      ? settingsStore.retryLibrary()
      : settingsStore.chooseChatHomesRoot());
    if (opened) onSelected();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sunken text-muted-foreground">
          <FolderOpen className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          {settings ? (
            /* 路径的身份在尾段：truncate 会先吃掉 `…/chat-homes`，
               恰好抹掉用户唯一认得出的部分。宁可折两行也要留全。 */
            <p
              className="line-clamp-2 break-all font-mono text-sm"
              title={settings.chatHomesRoot ?? undefined}
            >
              {settings.chatHomesRoot ?? (
                <span className="font-medium font-sans">
                  {t("onboarding.chatHomeUnset")}
                </span>
              )}
            </p>
          ) : (
            <Skeleton className="h-3.5 w-64 max-w-full" />
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t(`onboarding.chatHome.${state}`)}
          </p>
        </div>
        {error ? (
          <Button size="lg" variant="outline" onClick={settingsStore.retrySettings}>
            {t("common.retry")}
          </Button>
        ) : !chosen || state !== "ready" ? (
          <Button
            size="lg"
            disabled={chatHomesRootBusy || !settings}
            onClick={() => void openFolder()}
          >
            {chatHomesRootBusy && <Spinner className="size-3.5" />}
            {t(
              chatHomesRootBusy
                ? "onboarding.opening"
                : chosen
                  ? "common.retry"
                  : "onboarding.choose"
            )}
          </Button>
        ) : null}
      </div>
      <FolderProgress progress={folderProgress} />
      {(error || chatHomesRootError) && (
        <p role="alert" className="text-destructive text-xs">
          {chatHomesRootError || error}
        </p>
      )}
    </>
  );
}
