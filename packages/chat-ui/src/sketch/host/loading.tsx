/**
 * [INPUT]: Depends on shared Skeleton/Button primitives, Sketch layout styles, and localized labels.
 * [OUTPUT]: Provides a full-size canvas placeholder with matching compact tools, floating controls, and a close-only leading header.
 * [POS]: Lightweight fallback inside the real Sketch dialog while drawing content loads.
 */
import { XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { useSketchTranslation as useAppTranslation } from "../platform";
import { PRESET_COLORS } from "../model/document";

function ControlSkeleton() {
  return (
    <span className="sketch-control-skeleton grid size-11 shrink-0 place-items-center">
      <Skeleton className="size-6 rounded-full motion-reduce:animate-none" />
    </span>
  );
}

export function SketchLoading({ onClose }: { onClose(): void }) {
  const { t } = useAppTranslation();
  return (
    <div className="sketch-layout" data-sketch-loading>
      <header className="sketch-header">
        <div className="sketch-exit flex">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-11 shrink-0 rounded-full"
            aria-label={t("common.close")}
            data-sketch-loading-close
            onClick={onClose}
          >
            <XIcon className="size-5" aria-hidden="true" />
          </Button>
        </div>
        <div
          className="sketch-tools flex items-center rounded-full"
          aria-hidden="true"
        >
          {Array.from({ length: 5 }, (_, index) => <ControlSkeleton key={index} />)}
        </div>
        <div className="sketch-history flex justify-end gap-1" aria-hidden="true">
          <ControlSkeleton />
          <ControlSkeleton />
        </div>
      </header>
      <div className="sketch-paper pointer-events-none" aria-hidden="true">
        <Skeleton className="sketch-loading-canvas size-full rounded-none bg-black/5 motion-reduce:animate-none" />
      </div>
      <div className="sketch-width-rail" aria-hidden="true">
        <div className="sketch-width-control">
          <Skeleton className="h-1/2 w-2 rounded-full motion-reduce:animate-none" />
        </div>
      </div>
      <footer className="sketch-footer pointer-events-none" aria-hidden="true">
        <div className="sketch-colors flex flex-wrap items-center justify-center">
          {Array.from({ length: PRESET_COLORS.length + 1 }, (_, index) => (
            <ControlSkeleton key={index} />
          ))}
        </div>
        <div className="sketch-done"><ControlSkeleton /></div>
      </footer>
      <span className="sr-only" role="status">{t("common.loading")}</span>
    </div>
  );
}
