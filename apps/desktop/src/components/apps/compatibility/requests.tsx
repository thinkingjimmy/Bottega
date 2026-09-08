/**
 * [INPUT]: Depends on main-owned saved candidate references, typed change notifications and existing Apps navigation.
 * [OUTPUT]: Provides a passive upgrade-waiting list whose user action resumes the original candidate.
 * [POS]: Apps return-entry surface, including startup preparation and rejected updates to installed Apps.
 */

import { useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { listAppCompatibilityRequests, onAppCompatibilityChanged } from "@/lib/apps-client";
import type { AppCompatibilityFailure } from "../../../../shared/app-host/contract";

export function CompatibilityRequests({ onResume, highlightedId }: {
  onResume(failure: AppCompatibilityFailure): void; highlightedId?: string | null;
}) {
  const { t } = useAppTranslation();
  const [requests, setRequests] = useState<AppCompatibilityFailure[]>([]);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void listAppCompatibilityRequests().then((value) => {
        if (active && current === revision) setRequests(value);
      }).catch(() => {});
    };
    // The browser preview has no desktop bridge.
    if (!window.apps?.compatibilityRequests) return;
    const stop = onAppCompatibilityChanged(refresh);
    refresh();
    return () => { active = false; stop(); };
  }, []);
  if (!requests.length) return null;
  return <div className="mb-4 space-y-2" data-testid="app-compatibility-requests">
    {requests.map((failure) => <div key={failure.requestId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4" data-highlighted={highlightedId === failure.requestId || undefined}>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{failure.candidate.appName}</p>
        <p className="text-muted-foreground">{t(failure.code === "APP_HOST_UPDATE_REQUIRED" ? "appHost.waitingLabel" : "appHost.invalidTitle")}</p>
        {failure.candidate.hasUsableVersion && <p className="text-muted-foreground">{t("appHost.oldVersionUsable")}</p>}
      </div>
      <Button variant="outline" className="min-h-11" onClick={() => onResume(failure)}>{t("appHost.resume")}</Button>
    </div>)}
  </div>;
}
