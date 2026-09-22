/**
 * [INPUT]: Depends on bounded device IPC, the account computer subscription, the settings store's one-time hint flag, public device types, the i18n locale and shared Settings/shadcn primitives.
 * [OUTPUT]: Provides AccountComputer — this computer's display name with an inline machine-wide rename and the one-time suffix hint — and AccountDevices with visible-page refresh, stable editing, presence, rename and independent revocation.
 * [POS]: Settings page device controls; the kind is a fact in the row, and server ownership is checked on every action.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DeviceList } from "@ai-chat/ui/components/account/device-list";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsSection, SettingsButton, SettingsList, SettingsRow } from "@/components/settings/settings-layout";
import { cloudAccountClient } from "@/lib/cloud/client";
import { settingsStore } from "@/lib/settings-store";
import type { CloudComputerRenameReason, CloudComputersResult } from "../../../shared/cloud-ipc";

/**
 * Registration suffixes a name another computer already holds (`Studio Mac (2)`), shortening the base to fit;
 * a person's rename is refused instead, so this shape can only have come from the server.
 */
export function nameSuffixed(registered: string, current: string) {
  const match = /^(.+) \((?:\d+|[a-z0-9]{6})\)$/.exec(current);
  return Boolean(match) && current !== registered && registered.startsWith(match![1]!);
}
/** The server's three refusals, each a sentence the row says in place: a rename is never an unexplained failure. */
const renameRefusal = (reason: CloudComputerRenameReason, t: (key: string) => string) =>
  reason === "computer-name-taken" ? t("cloud.computers.nameTaken")
    : reason === "computer-not-found" ? t("cloud.computers.notFound") : t("cloud.computers.nameInvalid");
/** This computer's display name: one row, an inline rename that renames every installation on this machine. */
export function AccountComputer({ machine }: { machine: { idHash: string; name: string } }) {
  const { t } = useAppTranslation();
  const [result, setResult] = useState<CloudComputersResult>({ kind: "signed-out" });
  useEffect(() => {
    const client = cloudAccountClient(), stop = client.onComputersChanged(setResult);
    void client.getComputers().then(setResult).catch(() => {});
    return stop;
  }, []);
  const computer = result.kind === "computers" ? result.computers.find(item => item.machineIdHash === machine.idHash) : undefined;
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const hint = Boolean(computer && nameSuffixed(machine.name, computer.name)) && settings?.computerNameHintSeen === false;
  useEffect(() => {
    if (!hint) return;
    /* Marked seen when the page goes away, not while it is open: persisting it must not pull the sentence out
       from under the reader the moment it appears. */
    return () => { void settingsStore.update({ computerNameHintSeen: true }, t("cloud.actionFailed"), { errorScope: "local" }); };
  }, [hint, t]);
  const [editing, setEditing] = useState(false), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState("");
  if (!computer) return null;
  const save = () => {
    if (busy) return;
    setBusy(true); setFailure("");
    void cloudAccountClient().renameComputer({ name: name.trim() })
      .then(outcome => { if (outcome.kind === "renamed") setEditing(false); else setFailure(renameRefusal(outcome.reason, t)); })
      .catch(() => setFailure(t("cloud.actionFailed"))).finally(() => setBusy(false));
  };
  return <SettingsSection title={t("cloud.computers.thisComputer")} description={hint ? t("cloud.computers.suffixHint") : undefined}>
    <SettingsList><div data-slot="computer-row">
      <SettingsRow label={computer.name}
        control={<SettingsButton variant="ghost" disabled={busy} onClick={() => { setName(computer.name); setFailure(""); setEditing(true); }}>{t("cloud.rename")}</SettingsButton>} />
      {editing && <form className="flex flex-wrap items-end gap-2 px-4 pb-4" onSubmit={event => { event.preventDefault(); save(); }}>
        <div className="min-w-0 flex-1 space-y-2"><label htmlFor="computer-name" className="text-sm">{t("cloud.computers.name")}</label>
          <Input id="computer-name" value={name} onChange={event => setName(event.target.value)} required maxLength={40} autoFocus className="text-base" disabled={busy} /></div>
        <Button type="submit" disabled={busy || !name.trim()}>{busy ? t("cloud.saving") : t("cloud.save")}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{t("cloud.cancel")}</Button>
      </form>}
      {failure && <p role="alert" className="px-4 pb-4 text-destructive text-sm">{failure}</p>}
    </div></SettingsList>
  </SettingsSection>;
}

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
