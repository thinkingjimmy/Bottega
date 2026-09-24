/**
 * [INPUT]: Depends on the cloud account projection and its handshake-failure predicate, five-language cloud copy, Lucide icons, Settings primitives and the shared handshake retry button.
 * [OUTPUT]: Provides SyncTile (the Sync row's leading cloud tile) and useUnavailableRow (a failed handshake said in place: Sync · Unavailable · the reason · Retrying… with Try Now, or Try Again alone).
 * [POS]: setup/ shared row grammar; the signed-out row and the unfinished-setup row both report an unavailable service inside the row, never in a floating alert.
 */
import type { ReactNode } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { cloudHandshakeFailed, type CloudAccountState } from "../../../../shared/cloud-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsBadge } from "@/components/settings/settings-layout";
import { RetryConnectionButton } from "../retry-connection";

export function SyncTile() {
  return <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-muted text-foreground ring-1 ring-foreground/5 ring-inset">
    <Cloud className="size-[18px]" />
  </span>;
}

export type SyncRowProps = { label: string; badge?: ReactNode; description: ReactNode; control: ReactNode };

/* Main re-runs a failed handshake on a 30 s → 60 s → 120 s backoff for every error in this set. Only the
   two that clear on their own (a connection, a service update) say "Retrying…"; an outdated or mismatched
   build keeps being re-checked but never recovers without the reader, so it offers Try Again alone. */
/* Literal keys, one per handshake error, so the catalog audit can see every line this row reads. */
const UNAVAILABLE_KEYS: Partial<Record<NonNullable<CloudAccountState["error"]>, string>> = {
  "connection-failed": "cloud.serviceUnavailable.connection-failed", "server-outdated": "cloud.serviceUnavailable.server-outdated",
  "client-outdated": "cloud.serviceUnavailable.client-outdated", "environment-mismatch": "cloud.serviceUnavailable.environment-mismatch",
};
const RECOVERS_ON_ITS_OWN = new Set<CloudAccountState["error"]>(["connection-failed", "server-outdated"]);

export function useUnavailableRow(state: CloudAccountState, extra?: ReactNode): SyncRowProps | null {
  const { t } = useAppTranslation();
  // Main stops re-checking while a sign-in or sign-out owns the connection, and so does this row.
  if (!cloudHandshakeFailed(state) || !state.error || state.signOutPending || state.status === "signing-in") return null;
  const automatic = RECOVERS_ON_ITS_OWN.has(state.error);
  return {
    label: t("cloud.sync"), badge: <SettingsBadge tone="warn">{t("cloud.syncBadge.unavailable")}</SettingsBadge>,
    description: <span role="status">{t(UNAVAILABLE_KEYS[state.error] ?? "cloud.serviceUnavailable.connection-failed")}</span>,
    control: <span className="flex flex-wrap items-center justify-end gap-3">
      {extra}
      {automatic && <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />{t("cloud.retrying")}
      </span>}
      <RetryConnectionButton variant="outline" label={t(automatic ? "cloud.tryNow" : "cloud.tryAgain")} />
    </span>,
  };
}
