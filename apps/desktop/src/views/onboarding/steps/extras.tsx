/**
 * [INPUT]: Unified Skills discovery/import, local Memory settings, the memory store's providers and runtimes, the memory setup controller, dialog and consent flow.
 * [OUTPUT]: ExtrasStep offers optional Skills (inline import) and Memory (set up in the product's dialog without leaving the step; the row reports install progress, the connect step, readiness, and turns memory on through the disclosure dialog) with retryable inline failures.
 * [POS]: Local-only final onboarding step; memory never finishes onboarding or navigates away.
 */
import { Brain, Check, Loader2, RotateCw, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { settingsStore } from "@/lib/settings-store";
import { importAllDiscoveredSkills, listUnifiedSkillCandidates, listUnifiedSkills } from "@/lib/unified-skills-client";
import { MemoryDisclosureDialog } from "@/components/settings/memory/memory-disclosure-dialog";
import type { MemoryProviderDescriptor, MemoryRuntimeSnapshot } from "../../../../shared/memory-ipc";
import type { AppSettings } from "../../../../shared/settings-ipc";
import { MemorySetupDialog } from "../../settings-memory/memory-setup-dialog";
import { useMemoryConsent } from "../../settings-memory/use-memory-consent";
import { useMemorySetupController } from "../../settings-memory/use-memory-setup";
/* The same anatomy as the Agent rows one step earlier: a 16px mark on the title line, the sentence under it, the
   action at the column's right edge. Only when the column itself gets narrow (a small window) does the action drop
   under the text — and then it keeps that right edge, so the rows still read as one list. */
const ROW = "grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 py-4 @max-[30rem]/extras:grid-cols-[1rem_minmax(0,1fr)]";
const ICON = "mt-0.5 flex size-4 shrink-0 items-center justify-center";
const ACTION = "self-center @max-[30rem]/extras:col-start-2 @max-[30rem]/extras:justify-self-end";

function SkillsOptionRow({ disabled }: { disabled: boolean }) {
  const { t } = useAppTranslation();
  const { settings, error: settingsError } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const [count, setCount] = useState(0);
  const [libraryEmpty, setLibraryEmpty] = useState(true);
  const [busy, setBusy] = useState(true);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [failure, setFailure] = useState<{
    action: "scan" | "import";
    message: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([listUnifiedSkills(), listUnifiedSkillCandidates("all", false)])
      .then(([snapshot, preview]) => {
        if (!live) return;
        setFailure(null);
        setLibraryEmpty(snapshot.personalLibraryEmpty);
        setCount(preview.candidates.filter(
          (candidate) => candidate.importable && candidate.status !== "current"
        ).length);
      })
      .catch((cause) => live && setFailure({
        action: "scan",
        message: cause instanceof Error ? cause.message : String(cause),
      }))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [scanAttempt]);

  const imported = settings?.skillsOnboarding === "done" || !libraryEmpty;
  const scanFailed = failure?.action === "scan";
  const error = scanFailed
    ? t("onboarding.skillsScanFailed")
    : failure?.message || settingsError;
  const showError = Boolean(error) && !busy;
  const retryScan = () => {
    setBusy(true);
    setScanAttempt((value) => value + 1);
  };
  const importAll = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const snapshot = await importAllDiscoveredSkills();
      setLibraryEmpty(snapshot.personalLibraryEmpty);
      await settingsStore.update(
        { skillsOnboarding: "done" },
        t("onboarding.skillsUpdateFailed")
      );
    } catch (cause) {
      setFailure({
        action: "import",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={ROW}>
      <span className={cn(ICON, showError ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
        {showError ? <TriangleAlert className="size-4" /> : <Sparkles className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">
          {t("onboarding.extras.skills")}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs" role={showError ? "alert" : undefined}>
          {busy
            ? t("onboarding.skillsScanning")
            : error
              ? error
              : imported
                ? t("onboarding.skillsDone")
                : count > 0
                  ? t("onboarding.skillsFound", { count })
                  : t("onboarding.skillsNone")}
        </p>
      </div>
      {scanFailed ? (
        <Button
          className={ACTION}
          disabled={busy || disabled}
          onClick={retryScan}
          size="lg"
          variant="outline"
        >
          {busy ? <Spinner className="size-3.5" /> : <RotateCw className="size-3.5" />}
          {t("common.retry")}
        </Button>
      ) : !imported && count > 0 && (
        <Button
          className={ACTION}
          disabled={busy || disabled}
          onClick={() => void importAll()}
          size="lg"
          variant="outline"
        >
          {busy && <Spinner className="size-3.5" />}
          {t("onboarding.skillsImportAll")}
        </Button>
      )}
    </div>
  );
}

/* ── The memory row reports where setup stands; it never finishes onboarding ──
   The sentence and the action come from the runtime snapshots, the same facts the
   Settings › Memory page reads: on → ready (turn on) → connect (installed, no model)
   → installing → failed → start. Setting up happens in the product's dialog over
   this step; turning on is the same disclosure dialog Settings uses. */
type MemoryRowState =
  | { kind: "on" | "start" }
  | { kind: "ready" | "installing" | "failed"; provider: MemoryProviderDescriptor }
  | { kind: "connect"; provider: MemoryProviderDescriptor; version: string };

export function memoryRowState(
  settings: AppSettings | null,
  providers: MemoryProviderDescriptor[],
  runtimes: Record<string, MemoryRuntimeSnapshot | undefined>
): MemoryRowState {
  if (settings?.memory.enabled) return { kind: "on" };
  const find = (test: (runtime: MemoryRuntimeSnapshot) => boolean) =>
    providers.find((item) => {
      const runtime = runtimes[item.id];
      return runtime ? test(runtime) : false;
    });
  const ready = find((runtime) => runtime.installed && runtime.configured);
  if (ready) return { kind: "ready", provider: ready };
  const installing = find((runtime) => runtime.phase === "running");
  if (installing) return { kind: "installing", provider: installing };
  const installed = find((runtime) => runtime.installed);
  if (installed) {
    return { kind: "connect", provider: installed, version: runtimes[installed.id]?.installedVersion ?? installed.lockedVersion ?? "" };
  }
  const failed = find((runtime) => !runtime.installed && Boolean(runtime.error));
  if (failed) return { kind: "failed", provider: failed };
  return { kind: "start" };
}

function MemoryOptionRow({ disabled }: { disabled: boolean }) {
  const { t } = useAppTranslation();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const setup = useMemorySetupController();
  const consent = useMemoryConsent(settings ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const state = memoryRowState(settings ?? null, setup.providers, setup.runtimes);
  const description =
    state.kind === "on" ? t("onboarding.memoryEnabled")
      : state.kind === "ready" ? t("onboarding.memoryReady", { provider: state.provider.displayName })
        : state.kind === "connect" ? t("onboarding.memoryConnect", { provider: state.provider.displayName, version: state.version })
          : state.kind === "installing" ? t("onboarding.memoryInstalling", { provider: state.provider.displayName })
            : state.kind === "failed" ? t("onboarding.memoryInstallFailed", { provider: state.provider.displayName })
              : t("onboarding.memoryDisabled");
  const open = () => setDialogOpen(true);
  const action =
    state.kind === "on" ? null
      : state.kind === "ready" ? (
        <Button className={ACTION} disabled={disabled || consent.busy} size="lg" onClick={() => consent.openProvider(state.provider.id)}>
          {t("onboarding.memoryTurnOn")}
        </Button>
      ) : (
        <Button className={ACTION} disabled={disabled || setup.providers.length === 0} size="lg" variant="outline" onClick={open}>
          {state.kind === "installing" ? t("onboarding.memoryProgress") : state.kind === "start" ? t("onboarding.memoryAction") : t("common.continue")}
        </Button>
      );
  const consentProvider = setup.providers.find((item) => item.id === consent.intent?.providerId);
  return (
    <div className={ROW} data-memory-row={state.kind}>
      <span className={cn(ICON, state.kind === "on" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
        {state.kind === "on" ? <Check className="size-4" aria-hidden="true" />
          : state.kind === "installing" ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            : <Brain className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">
          {t("onboarding.extras.memory")}
        </p>
        <p className="mt-0.5 text-muted-foreground text-xs" role={state.kind === "failed" ? "alert" : state.kind === "installing" ? "status" : undefined}>
          {description}
        </p>
      </div>
      {action}
      {setup.providers.length > 0 && (
        <MemorySetupDialog open={dialogOpen} onOpenChange={setDialogOpen} {...setup.props} />
      )}
      {consentProvider && (
        <MemoryDisclosureDialog
          open={consent.intent !== null}
          onOpenChange={consent.setOpen}
          providerName={consentProvider.displayName}
          previousProviderName={
            consent.intent?.reason === "cutover"
              ? setup.providers.find((item) => item.id === settings?.memory.provider)?.displayName
              : undefined
          }
          reason={consent.intent?.reason ?? "enable"}
          preview={consent.preview}
          includeHistory={consent.includeHistory}
          onIncludeHistoryChange={consent.setIncludeHistory}
          historyDisabled={Boolean(settings?.memory.paused)}
          busy={consent.busy}
          error={consent.error}
          onAccept={() => void consent.accept()}
        />
      )}
    </div>
  );
}

export function ExtrasStep({ finishing }: { finishing: boolean }) {
  return (
    <>
      <div
        className={cn(
          "@container/extras divide-y divide-border overflow-hidden"
        )}
      >
        {window.unifiedSkills && <SkillsOptionRow disabled={finishing} />}
        <MemoryOptionRow disabled={finishing} />
      </div>
    </>
  );
}
