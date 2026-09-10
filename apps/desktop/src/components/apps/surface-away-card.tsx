/**
 * [INPUT]: Depends on surface residence DTOs, migration error projection, and UI Card/Button primitives.
 * [OUTPUT]: Provides SurfaceAwayCard with guarded focus/reclaim actions and localized inline failures.
 * [POS]: App-detail fail-closed placeholder; nonresident renderers never mount the live Studio beneath it
 */

import type { SurfaceResidence } from "../../../shared/window-surfaces-ipc";
import { useState } from "react";
import { surfaceErrorMessage } from "@/lib/chat-composer/errors";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ai-chat/ui/components/ui/card";
import {
  reclaimSurface,
  showSurface,
  windowContext,
} from "@/lib/window-surfaces-client";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function SurfaceAwayCard({
  residence,
  route,
}: {
  residence: SurfaceResidence;
  route: string;
}) {
  const { t } = useAppTranslation();
  const main = windowContext().role === "main";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (cause) { setError(surfaceErrorMessage(cause, t("windowSurface.openInWindowFailed"))); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid size-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("windowSurface.awayTitle")}</CardTitle>
          <CardDescription>{t("windowSurface.awayDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act(() => showSurface(residence.surface, route))}>
            {t("windowSurface.focusWindow")}
          </Button>
          {main && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(() => reclaimSurface(
                  residence.surface,
                  route,
                  residence.claimRevision
                ))
              }
            >
              {t("windowSurface.reclaim")}
            </Button>
          )}
          {error && <p className="w-full text-sm text-destructive" role="alert">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
