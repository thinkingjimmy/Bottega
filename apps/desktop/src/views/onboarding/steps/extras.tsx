/**
 * [INPUT]: Unified Skills discovery/import, local Memory settings, the memory store's providers and runtimes, the memory setup controller, dialog and consent flow, the Settings list primitives and SetupRowTile.
 * [OUTPUT]: ExtrasStep renders one list card with Skills (count badge, inline import) and Memory (state badge; set up in the product's dialog without leaving the step; inline install progress, Connect, Turn On through the disclosure dialog) with retryable inline failures; memoryRowState projects the Memory row.
 * [POS]: Local-only final onboarding step body inside OnboardingFrame; memory never finishes onboarding or navigates away.
 */
import { Brain, Check, RotateCw, Sparkles } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsBadge, SettingsButton, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { SetupRowTile } from "@/components/setup/row-tile";
import { settingsStore } from "@/lib/settings-store";
import { importAllDiscoveredSkills, listUnifiedSkillCandidates, listUnifiedSkills } from "@/lib/unified-skills-client";
import { MemoryDisclosureDialog } from "@/components/settings/memory/memory-disclosure-dialog";
import type { MemoryProviderDescriptor, MemoryRuntimeSnapshot } from "../../../../shared/memory-ipc";
import type { AppSettings } from "../../../../shared/settings-ipc";
import { MemorySetupDialog } from "../../settings-memory/memory-setup-dialog";
import { useMemoryConsent } from "../../settings-memory/use-memory-consent";
import { useMemorySetupController } from "../../settings-memory/use-memory-setup";

const DONE = <Check className="size-4 text-emerald-700 dark:text-emerald-400" strokeWidth={2.2} aria-hidden="true" />;

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
  const offer = !imported && count > 0;
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

  const description = busy
    ? t("onboarding.skillsScanning")
    : showError ? <span role="alert" className="text-destructive">{error}</span>
      : imported ? t("onboarding.skillsDone")
        : count > 0 ? t("onboarding.skillsAbout")
          : t("onboarding.skillsNone");
  const control = scanFailed ? (
    <SettingsButton disabled={busy || disabled} onClick={retryScan} variant="outline">
      {busy ? <Spinner className="size-3.5" /> : <RotateCw className="size-3.5" />}
      {t("common.retry")}
    </SettingsButton>
  ) : offer ? (
    <SettingsButton disabled={busy || disabled} onClick={() => void importAll()} variant="outline">
      {busy && <Spinner className="size-3.5" />}
      {t("onboarding.skillsImport")}
    </SettingsButton>
  ) : imported && !busy ? DONE : null;

  return (
    <SettingsRow
      leading={<SetupRowTile><Sparkles className="size-[18px]" strokeWidth={1.75} /></SetupRowTile>}
      label={t("onboarding.extras.skills")}
      badge={imported ? <SettingsBadge>{t("onboarding.skillsImported")}</SettingsBadge>
        : offer ? <SettingsBadge tone="muted">{t("onboarding.skillsFound", { count })}</SettingsBadge> : undefined}
      description={description}
      control={control}
    />
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

const MEMORY_BADGES = {
  start: "onboarding.memory.badge.start",
  installing: "onboarding.memory.badge.installing",
  failed: "onboarding.memory.badge.failed",
  connect: "onboarding.memory.badge.connect",
  ready: "onboarding.memory.badge.ready",
  on: "onboarding.memory.badge.on",
} as const satisfies Record<MemoryRowState["kind"], string>;
const badgeTone = (kind: MemoryRowState["kind"]) =>
  kind === "failed" ? "danger" : kind === "start" || kind === "installing" ? "muted" : "neutral";

/* One bar for the whole install: finished steps plus the active step's transfer share, the same facts the Settings runtime panel segments. */
function installShare(runtime: MemoryRuntimeSnapshot | undefined) {
  if (!runtime || runtime.stepTotal <= 0) return null;
  const transfer = runtime.transfer?.totalBytes ? Math.min(1, runtime.transfer.receivedBytes / runtime.transfer.totalBytes) : 0;
  return Math.min(1, (runtime.stepIndex + transfer) / runtime.stepTotal);
}

function InstallBar({ share }: { share: number }) {
  const percent = Math.round(share * 100);
  return <div className="flex items-center gap-2.5 pr-4 pb-3 pl-[76px]">
    <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
      className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
      <span className="block h-full origin-left rounded-full bg-foreground motion-safe:transition-transform" style={{ transform: `scaleX(${share})` }} />
    </span>
    <span className="text-[11px] text-muted-foreground tabular-nums">{percent}%</span>
  </div>;
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
    state.kind === "on" ? t("onboarding.memory.on")
      : state.kind === "ready" ? t("onboarding.memory.ready", { provider: state.provider.displayName })
        : state.kind === "connect" ? t("onboarding.memory.connect", { provider: state.provider.displayName, version: state.version })
          : state.kind === "installing" ? <span role="status">{t("onboarding.memory.installing", { provider: state.provider.displayName })}</span>
            : state.kind === "failed" ? <span role="alert">{t("onboarding.memory.failed", { provider: state.provider.displayName })}</span>
              : t("onboarding.memory.about");
  const open = () => setDialogOpen(true);
  const unavailable = disabled || setup.providers.length === 0;
  const control: ReactNode =
    state.kind === "on" ? DONE
      : state.kind === "ready" ? (
        <SettingsButton disabled={disabled || consent.busy} onClick={() => consent.openProvider(state.provider.id)}>
          {t("onboarding.memory.turnOn")}
        </SettingsButton>
      ) : state.kind === "connect" ? (
        <SettingsButton disabled={unavailable} onClick={open}>{t("onboarding.memory.connectAction")}</SettingsButton>
      ) : state.kind === "installing" ? (
        <SettingsButton disabled={unavailable} variant="ghost" onClick={open}>{t("onboarding.memory.progress")}</SettingsButton>
      ) : (
        <SettingsButton disabled={unavailable} variant="outline" onClick={open}>
          {t(state.kind === "failed" ? "onboarding.memory.retry" : "onboarding.memory.setUp")}
        </SettingsButton>
      );
  const share = state.kind === "installing" ? installShare(setup.runtimes[state.provider.id]) : null;
  const consentProvider = setup.providers.find((item) => item.id === consent.intent?.providerId);
  return (
    <div data-memory-row={state.kind}>
      <SettingsRow
        leading={<SetupRowTile><Brain className="size-[18px]" strokeWidth={1.75} /></SetupRowTile>}
        label={t("onboarding.extras.memory")}
        badge={<SettingsBadge tone={badgeTone(state.kind)}>{t(MEMORY_BADGES[state.kind])}</SettingsBadge>}
        description={description}
        control={control}
      />
      {share !== null && <InstallBar share={share} />}
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
    <SettingsList>
      {window.unifiedSkills && <SkillsOptionRow disabled={finishing} />}
      <MemoryOptionRow disabled={finishing} />
    </SettingsList>
  );
}
