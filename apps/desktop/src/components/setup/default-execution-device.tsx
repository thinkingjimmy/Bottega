/**
 * [INPUT]: Depends on durable settings, account-fenced remote discovery and shared device copy.
 * [OUTPUT]: Provides a persistent default-device preference and selectable desktop list independent of live send eligibility.
 * [POS]: Reusable Agent setup/settings control; remote execution stays in the shared command facade.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { backendName, remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import { useRemoteTargets } from "@ai-chat/chat-ui/remote-hooks";
import { useDesktopChatSources } from "@/lib/cloud/chat/sources";
import { useCloudAccount } from "@/lib/cloud/client";
import { settingsStore } from "@/lib/settings-store";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function useDefaultExecutionDevice() {
  const { settings } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const account = useCloudAccount(), sources = useDesktopChatSources();
  const targets = useRemoteTargets(sources?.executor.remote, null);
  const { t, i18n } = useAppTranslation(), copy = remoteCopy(i18n.language);
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const flight = useRef(false);
  useEffect(() => { settingsStore.ensureLoaded(); }, []);
  const available = account.status === "ready" && account.encryption.status === "unlocked" && Boolean(targets.value?.remoteControlEnabled) && !targets.error;
  const items = targets.items.filter(item => item.deviceId !== targets.value?.localDeviceId);
  const select = async (deviceId: string | null) => {
    if (flight.current || (deviceId && (!available || !items.some(item => item.deviceId === deviceId)))) return false;
    flight.current = true; setSaving(true); setError("");
    try {
      const saved = await settingsStore.update({ defaultExecutionDeviceId: deviceId }, t("settings.backends.defaultExecutionSaveFailed"), { errorScope: "local" });
      if (!saved) setError(t("settings.backends.defaultExecutionSaveFailed"));
      return saved;
    } finally { flight.current = false; setSaving(false); }
  };
  return { deviceId: settings?.defaultExecutionDeviceId ?? null, available, items, targets, copy, saving, error, select };
}

export function DefaultExecutionDeviceList({ preference }: { preference: ReturnType<typeof useDefaultExecutionDevice> }) {
  const { t } = useAppTranslation(), { items, targets, copy, deviceId, available, saving, error, select } = preference;
  return <div className="space-y-3">
    <fieldset className="space-y-2" disabled={!available || saving}>
      <legend className="sr-only">{copy.computer}</legend>
      {items.map(item => {
        const agents = item.agents.filter(agent => agent.available).map(agent => backendName(agent.backend));
        const detail = !item.online ? copy.offline : item.protocolVersion !== targets.value?.sourceProtocolVersion ? copy.update : agents.join(" · ") || copy.noAgent;
        return <label key={item.deviceId} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md p-3 text-sm ring-1 ring-inset ring-foreground/15 has-checked:ring-foreground">
          <input type="radio" name="default-execution-device" value={item.deviceId} checked={deviceId === item.deviceId} onChange={() => void select(item.deviceId)} className="size-4 accent-foreground" />
          <span className="min-w-0"><span className="block truncate font-medium">{item.name}</span><span className="text-muted-foreground">{detail}</span></span>
        </label>;
      })}
    </fieldset>
    {!items.length && <p className="text-sm text-muted-foreground" role="status">{t("onboarding.remoteEmpty")}</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}
