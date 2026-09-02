"use client";

/**
 * [INPUT]: Depends on React state/callback, router navigation, Archive i18n, settings archive locators, error projection, lucide icons, and shadcn Button/Sonner
 * [OUTPUT]: Provides the dedicated interactive ArchiveFeedbackToaster and useSidebarArchiveFeedback for Chat and Project success/undo flows
 * [POS]: Sidebar archive feedback boundary; data owners supply Undo while this module owns one no-drag visual, navigation, retry, and dismissal language
 */

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Archive, X } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  archiveSettingsTargetPath,
  type ArchivedSettingsLocator,
} from "@/lib/settings-navigation";
import { errorMessage } from "@/lib/errors";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Toaster, toast } from "@ai-chat/ui/components/ui/sonner";

const ARCHIVE_FEEDBACK_TOASTER_ID = "sidebar-archive-feedback";
const ARCHIVE_FEEDBACK_DURATION = 8_000;

const titleKey = {
  chat: "archive.toast.archivedChat",
  project: "archive.toast.archivedProject",
} as const;

type ArchiveFeedbackInput = ArchivedSettingsLocator & {
  undo(): Promise<unknown>;
};

function ArchiveFeedbackContent({
  toastId,
  target,
  undo,
  onView,
}: {
  toastId: string | number;
  target: ArchivedSettingsLocator;
  undo(): Promise<unknown>;
  onView(): void;
}) {
  const { t } = useAppTranslation();
  const [undoing, setUndoing] = useState(false);
  const undoingRef = useRef(false);

  const view = () => {
    toast.dismiss(toastId);
    onView();
  };

  const restore = async () => {
    if (undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    try {
      await undo();
      toast.dismiss(toastId);
    } catch (cause) {
      toast.error(
        t("archive.toast.undoFailed", { message: errorMessage(cause) })
      );
      undoingRef.current = false;
      setUndoing(false);
    }
  };

  return (
    <div
      data-archive-kind={target.kind}
      data-testid="archive-feedback-toast"
      className="flex min-h-10 w-max max-w-[calc(100vw-2rem)] items-center gap-0 rounded-[14px] border border-border/80 bg-popover py-1.5 pr-2 pl-3.5 text-popover-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)] [-webkit-app-region:no-drag] [&_button]:cursor-pointer"
    >
      <Archive aria-hidden className="mr-2.5 size-3 shrink-0" />
      <span className="mr-3 min-w-0 max-w-48 truncate text-sm font-medium">
        {t(titleKey[target.kind])}
      </span>
      <Button
        className="mr-2 rounded-full px-1.5 text-sm font-normal"
        size="sm"
        variant="secondary"
        onClick={view}
      >
        {t("archive.toast.view")}
      </Button>
      <Button
        className="mr-1 rounded-full px-1.5 text-sm font-normal"
        disabled={undoing}
        size="sm"
        onClick={() => void restore()}
      >
        {t("archive.toast.undo")}
      </Button>
      <Button
        aria-label={t("common.close")}
        className="rounded-full"
        size="icon-sm"
        variant="ghost"
        onClick={() => toast.dismiss(toastId)}
      >
        <X />
      </Button>
    </div>
  );
}

export function ArchiveFeedbackToaster({
  theme,
}: {
  theme: "light" | "dark";
}) {
  return (
    <Toaster
      id={ARCHIVE_FEEDBACK_TOASTER_ID}
      theme={theme}
      position="top-center"
      offset={{ top: 16 }}
      mobileOffset={{ top: 16 }}
      visibleToasts={3}
      gap={8}
    />
  );
}

export function useSidebarArchiveFeedback() {
  const navigate = useNavigate();
  return useCallback((input: ArchiveFeedbackInput) => {
    const target: ArchivedSettingsLocator = {
      kind: input.kind,
      id: input.id,
    };
    return toast.custom(
      (toastId) => (
        <ArchiveFeedbackContent
          toastId={toastId}
          target={target}
          undo={input.undo}
          onView={() => void navigate(archiveSettingsTargetPath(target))}
        />
      ),
      {
        duration: ARCHIVE_FEEDBACK_DURATION,
        toasterId: ARCHIVE_FEEDBACK_TOASTER_ID,
        unstyled: true,
      }
    );
  }, [navigate]);
}
