/**
 * [INPUT]: Depends on bounded device IPC, public device types, the i18n locale and shared Settings/shadcn primitives.
 * [OUTPUT]: Provides AccountDevices with visible-page refresh, stable editing, presence, rename and independent revocation.
 * [POS]: Settings page device controls; the kind is a fact in the row, and server ownership is checked on every action.
 */
import { useCallback, useEffect, useState } from "react";
import { DeviceList } from "@ai-chat/ui/components/account/device-list";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsSection, SettingsButton } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";

export function AccountDevices({ accountId }: { accountId: string }) {
  const { t, i18n } = useAppTranslation();
  const [cursor, setCursor] = useState<string | null>(null), [revision, setRevision] = useState(0);
  /* Revoked sessions are history, not a device the user can act on: the list asks the server for active ones. */
  const [past, setPast] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; page: Awaited<ReturnType<ReturnType<typeof cloudAccountClient>["listDevices"]>> } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = JSON.stringify([accountId, cursor, revision, past]);
  const page = loaded?.key === key ? loaded.page : null, failed = failedKey === key;
  const refresh = useCallback(() => { setRevision(value => value + 1); }, []);
  useEffect(() => {
    let active = true, busy = false;
    const read = () => {
      if (!active || busy || document.visibilityState === "hidden") return;
      busy = true;
      void cloudAccountClient().listDevices(past ? { cursor } : { cursor, state: "active" })
      .then(value => { if (active) { setLoaded({ key, page: value }); setFailedKey(null); } })
      .catch(() => { if (active) setFailedKey(key); }).finally(() => { busy = false; });
    };
    read(); const timer = setInterval(read, 30_000);
    document.addEventListener("visibilitychange", read);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [cursor, key, past]);
  return <SettingsSection title={t("cloud.devices")} alert={failed ? t("cloud.loadFailed") : undefined}
    action={<div className="flex flex-wrap items-center gap-1">
      {/* A filter, not a navigation: the pressed state is the whole announcement, so the label never changes. */}
      <SettingsButton variant="ghost" aria-pressed={past} onClick={() => { setPast(value => !value); setCursor(null); }}>{t("cloud.showPastSessions")}</SettingsButton>
      <SettingsButton variant="ghost" onClick={refresh}>{t("cloud.refresh")}</SettingsButton>
    </div>}>
    {!page ? <p role="status" className="text-muted-foreground text-sm">{failed ? t("cloud.loadFailed") : t("common.loading")}</p> :
      page.devices.length > 0 ? <DeviceList devices={page.devices} locale={i18n.language} copy={(key, values) => t(`cloud.${key}`, values)} capabilities={{ rename: true, revoke: device => !device.current }}
        onRename={async (device, name) => { await cloudAccountClient().renameDevice({ deviceId: device.deviceId, name }); refresh(); }}
        onRevoke={async device => { await cloudAccountClient().revokeDevice({ deviceId: device.deviceId }); refresh(); }} /> :
        <p className="text-muted-foreground text-sm">{t("cloud.noDevices")}</p>}
    {(page && !page.complete || cursor) && <div className="flex gap-2">{page && !page.complete && <SettingsButton variant="outline" onClick={() => setCursor(page.cursor)}>{t("cloud.nextPage")}</SettingsButton>}
      {cursor && <SettingsButton variant="ghost" onClick={() => setCursor(null)}>{t("cloud.firstPage")}</SettingsButton>}</div>}
  </SettingsSection>;
}
