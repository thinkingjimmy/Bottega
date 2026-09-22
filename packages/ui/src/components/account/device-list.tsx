/**
 * [INPUT]: Public device facts, localized labels and host-owned rename/revoke/refresh capabilities.
 * [OUTPUT]: One shared device list with inline kind, presence, version, stable editing and confirmation, and the relative moment every account presence surface reads.
 * [POS]: Pure account presentation; the host owns current-session key cleanup and transport authority.
 */
import { useId, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ConfirmationDialog } from "../ui/app-dialog";
import { SettingsList, SettingsRow, SettingsBadge } from "../settings/content";
import { SettingsButton } from "../settings/controls";
import { relativeMoment } from "./moment";
export { relativeMoment };
export interface AccountDevice {
  deviceId: string; name: string; current: boolean;
  state: "active" | "revoked" | "expired";
  presenceState: "online" | "offline";
  lastHeartbeatAt: number | null;
  platform: "macos" | "windows" | "linux" | "browser";
  kind: "desktop" | "web"; appVersion: string;
}
export interface DeviceListProps {
  devices: AccountDevice[];
  copy(key: string, values?: Record<string, string>): string;
  locale: string;
  disabled?: boolean;
  capabilities: { rename: boolean; revoke(device: AccountDevice): boolean; refresh?: boolean };
  onRename(device: AccountDevice, name: string): Promise<unknown>;
  onRevoke(device: AccountDevice): Promise<unknown>;
  onRefresh?(): void;
}
export function DeviceList(props: DeviceListProps) {
  return <div>{props.capabilities.refresh && props.onRefresh && <SettingsButton variant="ghost" disabled={props.disabled} onClick={props.onRefresh}>{props.copy("refresh")}</SettingsButton>}
    <SettingsList>{props.devices.map(device => <DeviceRow key={device.deviceId} {...props} device={device} />)}</SettingsList>
  </div>;
}
function DeviceRow({ device, ...props }: DeviceListProps & { device: AccountDevice }) {
  const { copy, locale, disabled, capabilities, onRename, onRevoke } = props;
  const t = (key: string, values?: Record<string, string>) => copy(key.replace(/^cloud\./, ""), values); const inputId = useId();
  const [editing, setEditing] = useState(false), [name, setName] = useState(device.name), [revoke, setRevoke] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const run = (action: "rename" | "revoke") => {
    if (busy) return; setBusy(true); setFailed(false);
    if (disabled || action === "rename" && !capabilities.rename || action === "revoke" && !capabilities.revoke(device)) { setBusy(false); return; }
    void Promise.resolve().then(() => action === "rename" ? onRename(device, name.trim()) : onRevoke(device))
      .then(() => { setEditing(false); setRevoke(false); }).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  /* presence · platform · version: every fact the server already knows about the device. */
  const presence = device.state === "revoked" ? t("cloud.revoked") : device.presenceState === "online" ? t("cloud.online") :
    device.lastHeartbeatAt ? t("cloud.lastSeen", { when: relativeMoment(device.lastHeartbeatAt, locale) }) : t("cloud.offline");
  const description = [presence, t(`cloud.platform.${device.platform}`), device.kind === "web" ? t("cloud.webSession") : t("cloud.appVersion", { version: device.appVersion })].join(" · ");
  return <div data-slot="device-row">
    <SettingsRow label={device.name} description={description}
      badge={device.current && <SettingsBadge>{t("cloud.current")}</SettingsBadge>}
      control={device.state === "active" && <div className="flex flex-wrap gap-1">
        {capabilities.rename && <SettingsButton variant="ghost" disabled={disabled || busy} onClick={() => { setName(device.name); setFailed(false); setEditing(true); }}>{t("cloud.rename")}</SettingsButton>}
        {capabilities.revoke(device) && <SettingsButton disabled={disabled || busy} variant="ghost" onClick={() => { setFailed(false); setRevoke(true); }}>{t("cloud.revoke")}</SettingsButton>}</div>} />
    {editing && <form className="flex flex-wrap items-end gap-2 px-4 pb-4" onSubmit={event => { event.preventDefault(); run("rename"); }}>
      <div className="min-w-0 flex-1 space-y-2"><label htmlFor={inputId} className="text-sm">{t("cloud.deviceName")}</label>
        <Input id={inputId} value={name} onChange={event => setName(event.target.value)} required maxLength={40} autoFocus className="text-base" disabled={busy} /></div>
      <Button type="submit" disabled={disabled || busy || !name.trim()}>{busy ? t("cloud.saving") : t("cloud.save")}</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>{t("cloud.cancel")}</Button>
    </form>}
    {failed && !revoke && <p role="alert" className="px-4 pb-4 text-destructive text-sm">{t("cloud.actionFailed")}</p>}
    <ConfirmationDialog open={revoke} onOpenChange={setRevoke} title={t("cloud.revokeTitle")} busy={busy} confirmTone="destructive"
      description={failed ? t("cloud.actionFailed") : t("cloud.revokeDescription")} confirmLabel={busy ? t("cloud.revoking") : t("cloud.revoke")}
      cancelLabel={t("cloud.cancel")} onConfirm={() => { if (!busy) run("revoke"); }} />
  </div>;
}
