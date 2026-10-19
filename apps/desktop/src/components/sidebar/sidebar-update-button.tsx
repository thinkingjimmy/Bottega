/**
 * [INPUT]: Depends on React store hooks, i18n, Sidebar update verdicts, update-client commands, external-link IPC, shared UpdateProgress and lucide glyphs.
 * [OUTPUT]: Provides SidebarUpdateButton with labeled update actions and noninteractive download/install status.
 * [POS]: Sidebar footer presentation; downloading starts in place and restart requires an explicit action.
 */

import { useEffect, useSyncExternalStore } from "react";
import { CircleAlert, Download, ExternalLink, Loader2, RotateCw } from "lucide-react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { UpdateProgress } from "@/components/updates/update-progress";
import { openExternal } from "@/lib/agent/agent-client";
import { RELEASE_URL, updateStore } from "@/lib/platform/update-client";
import {
  describeSidebarUpdate,
  type SidebarUpdateGlyph,
  type SidebarUpdateTone,
} from "@/lib/navigation/sidebar/sidebar-update-view";

const GLYPHS: Record<SidebarUpdateGlyph, typeof CircleAlert> = {
  download: Download,
  external: ExternalLink,
  spinner: Loader2,
  alert: CircleAlert,
  restart: RotateCw,
};

const TONES: Record<SidebarUpdateTone, string> = {
  loud: "text-sidebar-foreground",
  quiet: "text-muted-foreground",
  danger: "text-destructive",
};

const SHELL = "relative ml-auto flex h-8 min-w-0 max-w-40 flex-[0_1_10rem] items-center justify-center gap-1.5 rounded-lg px-2 text-xs outline-none transition-colors motion-reduce:transition-none";
const FOCUS = "touch-manipulation cursor-pointer bg-sidebar-accent hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar";

export function SidebarUpdateButton({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  const { t } = useAppTranslation();
  const update = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  useEffect(() => { updateStore.ensureLoaded(); }, []);

  const view = describeSidebarUpdate(update);
  if (!view) return null;

  const label = t(view.labelKey, view.labelVars);
  const text = t(view.textKey, view.labelVars);
  const fullText = view.percent === null ? text : t("settings.updates.downloadProgress", view.labelVars);
  const title = fullText === label ? label : `${fullText} — ${label}`;
  const Glyph = GLYPHS[view.glyph];
  const body = <>
    <Glyph aria-hidden className={cn("size-4 shrink-0", view.glyph === "spinner" && "motion-safe:animate-spin")} />
    <span className="min-w-0 truncate tabular-nums">{text}</span>
    {view.percent !== null && <span className="shrink-0 tabular-nums">{" · "}{view.percent}%</span>}
  </>;

  if (!view.intent) {
    return (
      <div role="status" aria-label={label} title={title} className={cn(SHELL, TONES[view.tone])}>
        {body}
        {view.percent !== null && <UpdateProgress percent={view.percent} label={label} className="absolute right-2 bottom-0 left-2" />}
      </div>
    );
  }

  return (
    <button type="button" aria-label={label} title={title} className={cn(SHELL, FOCUS, TONES[view.tone])}
      onClick={() => {
        if (view.intent === "restart") return void updateStore.installNow();
        if (view.intent === "install") return void updateStore.downloadAndInstall();
        if (view.intent === "releases") return void openExternal(RELEASE_URL);
        onOpenUpdates();
      }}>
      {body}
    </button>
  );
}
