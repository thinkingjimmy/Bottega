/**
 * [INPUT]: Depends on shared surface residence DTOs, window surface client intents, and UI Card/Button primitives
 * [OUTPUT]: Provides SurfaceAwayCard with focus and reclaim actions for a surface resident in another window
 * [POS]: App-detail fail-closed placeholder; nonresident renderers never mount the live Studio beneath it
 */

import type { SurfaceResidence } from "../../../shared/window-surfaces-ipc";
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
  return (
    <div className="grid size-full place-items-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("windowSurface.awayTitle")}</CardTitle>
          <CardDescription>{t("windowSurface.awayDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button onClick={() => void showSurface(residence.surface, route)}>
            {t("windowSurface.focusWindow")}
          </Button>
          {main && (
            <Button
              variant="outline"
              onClick={() =>
                void reclaimSurface(
                  residence.surface,
                  route,
                  residence.claimRevision
                )
              }
            >
              {t("windowSurface.reclaim")}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
