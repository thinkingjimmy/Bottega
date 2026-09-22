/**
 * [INPUT]: Depends on main-owned sync progress and encryption state, five-language copy, the shared encryption error mapper, settings primitives, the unlock button, the handshake retry action and the router.
 * [OUTPUT]: Provides AccountSync — the settings page's single Sync row (badge, one sentence, a byte-led progress bar that falls back to whole items, and only the action the state itself needs) — and AppPackagesSection for blocked App packages.
 * [POS]: Settings sync projection; signing in is what publishes this computer, so the row carries no switch — unlock retains its dialog through key derivation, an unavailable handshake keeps its own retry, and cancelled discovery or an unfinished disconnect retains a retry exit.
 */
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getCloudEncryptionCopy } from "@ai-chat/ui/lib/cloud-copy/encryption";
import { cloudHandshakeFailed, type CloudAccountState } from "../../../shared/cloud-ipc";
import type { SyncProgress } from "../../../shared/cloud/sync";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsBadge, SettingsButton, SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";
import { encryptionError } from "./encryption/field-errors";
import { UnlockEncryptionButton } from "./encryption/status";
import { RetryConnectionButton } from "./retry-connection";

const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
type Tone = "neutral" | "warn" | "danger" | "muted";

// Bytes move with every message; whole items move once per Chat, which is minutes apart for a long one.
function Track({ sync }: { sync: SyncProgress }) {
  const ratio = sync.totalBytes > 0 ? sync.uploadedBytes / sync.totalBytes : sync.total > 0 ? sync.completed / sync.total : null;
  const percent = ratio === null ? null : Math.min(100, Math.round(ratio * 100));
  return <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
    className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <span className={percent === null ? "block h-full w-1/3 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" : "block h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none"}
      style={percent === null ? undefined : { width: `${percent}%` }} />
  </span>;
}

export function AccountSync({ state }: { state: CloudAccountState }) {
  const { t, i18n } = useAppTranslation(), copy = getCloudEncryptionCopy(i18n.language);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const sync = state.sync, encryption = state.encryption, ready = state.status === "ready";
  const unavailable = cloudHandshakeFailed(state);
  const action = (run: () => Promise<void>) => {
    if (busy) return; setBusy(true); setFailed(false);
    void run().catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  const retrySync = () => <SettingsButton disabled={!ready || busy} onClick={() => action(() => cloudAccountClient().retrySync())}>{t("cloud.retry")}</SettingsButton>;
  const waiting = [sync.pending > 0 && t("cloud.syncReview.pending", { count: sync.pending }), sync.conflicts > 0 && t("cloud.syncReview.conflicts", { count: sync.conflicts })]
    .filter(Boolean).map(text => ` · ${text}`).join("");
  /* One call site for every refusal: the owning computer is always offered and only the ownership sentence uses it. */
  const syncError = (value: SyncProgress, suffix = waiting) => t(`cloud.syncError.${value.error}`, { host: value.ownerHost ?? "" }) + suffix;

  /* One row, one badge, one sentence, and an action only where the state has one: being
     signed in is what publishes this computer, so there is nothing here to switch off.
     The status sentence is the default description; encryption states come first because a
     locked or blocked key stops sync whatever the outbox says. */
  let tone: Tone = "neutral", badge = t("cloud.syncBadge.synced"), control: ReactNode = null;
  let description: ReactNode = t(`cloud.syncStatus.${sync.status}`) + waiting;
  if (unavailable) { tone = "warn"; badge = t("cloud.syncBadge.unavailable"); description = t("cloud.syncUnavailable"); control = <RetryConnectionButton />; }
  else if (encryption.status === "checking") { tone = "muted"; badge = t("cloud.syncBadge.checking"); description = copy.checking; control = null; }
  else if (encryption.status === "locked" && encryption.canUnlock || encryption.status === "unlocking") { tone = "warn"; badge = t("cloud.syncBadge.locked"); description = t("cloud.syncRow.locked"); control = <UnlockEncryptionButton state={encryption} disabled={!ready} />; }
  else if (encryption.status === "blocked" || encryption.status === "locked" && encryption.canRetry || (encryption.error && encryption.status !== "unlocked")) {
    tone = "danger"; badge = t("cloud.syncBadge.attention"); description = encryptionError(encryption.error, i18n.language) ?? copy.unavailable;
    control = encryption.canRetry ? <SettingsButton disabled={!ready || busy} onClick={() => action(async () => { await cloudAccountClient().retryEncryption(); })}>{t("cloud.retry")}</SettingsButton> : null;
  } else switch (sync.status) {
    case "synced": description = t("cloud.syncRow.synced") + waiting; break;
    case "initializing": case "syncing": {
      const progress = sync.phase ? `${t(`cloud.syncPhase.${sync.phase}`)} · ` : "";
      const counted = sync.total > 0 ? t("cloud.syncReview.progress", { completed: sync.completed, total: sync.total }) : t(`cloud.syncStatus.${sync.status}`);
      const bytes = sync.totalBytes > 0 ? ` · ${size(sync.uploadedBytes)} / ${size(sync.totalBytes)}` : "";
      badge = t("cloud.syncBadge.syncing"); description = <>{progress}{counted}{bytes}<Track sync={sync} /></>; break;
    }
    case "partial": tone = "warn"; badge = t("cloud.syncBadge.attention"); break;
    /* Paused is now only the moment between consent and the first pass starting; nothing offers it. */
    case "paused": tone = "muted"; badge = t("cloud.syncBadge.paused"); break;
    case "offline": tone = "muted"; badge = t("cloud.syncBadge.offline"); break;
    /* A folder that belongs to another computer is the one error a retry cannot clear: it says so and offers nothing. */
    case "error": tone = "danger"; badge = t("cloud.syncBadge.attention"); if (sync.error) description = syncError(sync);
      control = sync.error === "library-owned-elsewhere" ? null : retrySync(); break;
    /* A cleanup that failed leaves the account half-disconnected; the row says so and
       re-enters the same idempotent disconnect instead of waiting for a restart. */
    case "closing":
      if (sync.error) { tone = "danger"; badge = t("cloud.syncBadge.attention"); description = syncError(sync, ""); control = retrySync(); }
      else { tone = "muted"; badge = t("cloud.syncBadge.closing"); control = null; }
      break;
    default: break;
  }
  return <SettingsSection title={t("cloud.sync")} alert={failed ? t("cloud.actionFailed") : undefined}>
    <SettingsList><SettingsRow label={t("cloud.sync")} badge={<SettingsBadge tone={tone}>{badge}</SettingsBadge>} description={description} control={control} /></SettingsList>
  </SettingsSection>;
}

/* Packages that need attention are a fact about Apps, fixed inside the App; the
   section exists only while there is one and never inside the setup form. */
export function AppPackagesSection({ issues }: { issues: SyncProgress["appIssues"] }) {
  const { t } = useAppTranslation(), navigate = useNavigate();
  if (issues.length === 0) return null;
  return <SettingsSection title={t("cloud.appPackages.title")} description={t("cloud.appPackages.description")}>
    <SettingsList>{issues.map(app => <SettingsRow key={app.appId} label={app.name} description={t(`cloud.syncAppBlocked.${app.reason}`)}
      control={<SettingsButton variant="ghost" onClick={() => { void navigate(`/apps/${encodeURIComponent(app.appId)}`); }}>{t("cloud.appPackages.open")}</SettingsButton>} />)}</SettingsList>
  </SettingsSection>;
}
