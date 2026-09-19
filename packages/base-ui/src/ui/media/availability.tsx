/**
 * [INPUT]: Depends on a logical local-image source identity and the host's account-scoped device-name reader.
 * [OUTPUT]: Provides a localized availability label without exposing paths or treating missing names as download failures.
 * [POS]: Shared Gallery and record attachment presentation; source bytes and cloud transport remain host-owned.
 */
import { useEffect, useState } from "react";
import type { BaseAttachmentValue } from "../../model/base-values";
import { useBasePlatform } from "../platform/context";
import { useAppTranslation } from "../platform/i18n";

export function useLocalImageLabel(availability?: BaseAttachmentValue["localAvailability"]) {
  const { attachments } = useBasePlatform(), { t } = useAppTranslation();
  const deviceId = availability?.sourceDeviceId;
  const [resolved, setResolved] = useState<{ reader: typeof attachments.sourceDeviceName; deviceId: string; name: string } | null>(null);
  useEffect(() => {
    if (!deviceId || !attachments.sourceDeviceName) return;
    const controller = new AbortController(), reader = attachments.sourceDeviceName;
    void reader(deviceId, controller.signal).then(name => {
      if (!controller.signal.aborted && name) setResolved({ reader, deviceId, name });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [attachments.sourceDeviceName, deviceId]);
  if (!deviceId) return null;
  const name = resolved?.deviceId === deviceId && resolved.reader === attachments.sourceDeviceName ? resolved.name : null;
  return name ? t("bases.gallery.onlyOnDevice", { device: name }) : t("bases.gallery.onlyOnSource");
}
