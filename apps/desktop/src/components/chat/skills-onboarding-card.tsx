/**
 * [INPUT]: Depends on the cached Skills onboarding snapshot, Library-first import, settingsStore, i18n, and Button
 * [OUTPUT]: Provides the one-time main-ready Skills import notice with separate title, description, and wrapping actions
 * [POS]: Chat-shell onboarding affordance; it never reads Agent paths, performs no IPC of its own on mount, and retires itself durably as done or skipped
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { settingsStore } from "@/lib/settings-store";
import { skillsOnboardingStore } from "@/lib/skills-onboarding-store";
import { importAllDiscoveredSkills } from "@/lib/unified-skills-client";

export function SkillsOnboardingCard() {
  const { t } = useAppTranslation();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  /* The answer belongs to the Skills domain and changes only when Skills do, so
     it is read once and kept; this card remounts on every chat navigation and
     used to pay two IPC round trips for the same unchanged answer each time. */
  const discovery = useSyncExternalStore(
    skillsOnboardingStore.subscribe,
    skillsOnboardingStore.getSnapshot
  );
  const count = discovery.importableCount;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    settingsStore.ensureLoaded();
    skillsOnboardingStore.ensureLoaded();
  }, []);

  if (
    !discovery.ready ||
    settings?.skillsOnboarding !== "pending" ||
    !discovery.personalLibraryEmpty ||
    count === 0
  ) return null;

  const retire = (state: "done" | "skipped") => settingsStore.update(
    { skillsOnboarding: state },
    t("onboarding.skillsUpdateFailed")
  );
  const importAll = async () => {
    setBusy(true);
    setError("");
    try {
      await importAllDiscoveredSkills();
      await retire("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <aside className="mx-auto mt-4 flex w-[min(46rem,calc(100%-2rem))] shrink-0 flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 shadow-none">
      <div className="flex min-w-0 flex-1 basis-80 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 font-medium">{t("onboarding.skillsImportTitle", { count })}</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{t("onboarding.skillsImportDescription")}</p>
          {error && <p role="alert" className="mt-1 text-xs break-words text-destructive">{error}</p>}
        </div>
      </div>
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
        <Button className="text-muted-foreground" disabled={busy} onClick={() => void retire("skipped")} size="lg" variant="ghost">
          {t("onboarding.skillsSkip")}
        </Button>
        <Button disabled={busy} onClick={() => void importAll()} size="lg">
          {busy && <Spinner className="size-3.5" />}
          {t("onboarding.skillsImportAll")}
        </Button>
      </div>
    </aside>
  );
}
