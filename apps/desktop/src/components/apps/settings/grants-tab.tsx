"use client";

/**
 * [INPUT]: Depends on the App grant-source listing and Studio revoke IPC, AppGrantsPanel, localized copy, and the Settings canvas
 * [OUTPUT]: Provides GrantsTab — scope audit sources with their own refresh revision, and the confirmed Studio revocation
 * [POS]: The fourth body of components/apps/settings; grant sources are read here and nowhere else
 */

import { useEffect, useState } from "react";
import { SettingsCanvas } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { listAppGrantSources, revokeAppStudioAccess } from "@/lib/apps-client";
import type { AppGrantSource } from "../../../../shared/apps-ipc";
import { AppGrantsPanel } from "../authorization/app-grants-panel";
import type { AppSettingsTabProps } from "./tab-shell";

export function GrantsTab({ record, fail, run }: AppSettingsTabProps) {
  const { t } = useAppTranslation();
  const [sources, setSources] = useState<AppGrantSource[]>([]);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void listAppGrantSources()
      .then((next) => {
        if (!active) return;
        setSources(
          [...next.chats, ...next.projects, ...next.globals]
            .filter((item) => item.appId === record.id)
        );
      })
      .catch((cause) => { if (active) fail(cause, t("apps.settingsReadFailed")); });
    return () => { active = false; };
  }, [fail, record.id, revision, t]);

  const reload = () => setRevision((value) => value + 1);

  return (
    <SettingsCanvas>
      <AppGrantsPanel
        onChanged={reload}
        onError={(cause) => fail(cause, t("apps.settingsDefaultFailed"))}
        /* 撤销后重读作用域清单；「已授权」那一行不必等这里刷新——它读的是
           main 随撤销一起广播的 studioSurfaceReady。 */
        onRevokeStudio={() => void run(
          () => revokeAppStudioAccess(record.id),
          t("apps.settingsStudioRevokeFailed")
        ).then(reload)}
        record={record}
        sources={sources}
      />
    </SettingsCanvas>
  );
}
