"use client";

/**
 * [INPUT]: Depends on React, router navigation, Archive i18n/locators, operation-scoped celebration commands, error projection, and shared feedback toast primitives
 * [OUTPUT]: Provides useSidebarArchiveFeedback with immediate celebration and optional Undo/View start callbacks
 * [POS]: Sidebar archive feedback boundary; data owners supply Undo, shared UI owns the visual, and this module owns archive navigation, retry, and dismissal
 */

import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Archive } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  archiveSettingsTargetPath,
  type ArchivedSettingsLocator,
} from "@/lib/settings-navigation";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { FeedbackToast, FeedbackToastAction, showFeedbackToast, toast } from "@ai-chat/ui/components/ui/sonner";
import { playArchiveConfetti, stopArchiveConfetti } from "@ai-chat/ui/components/archive/celebration/controller";

const titleKey = {
  chat: "archive.toast.archivedChat",
  project: "archive.toast.archivedProject",
} as const;

export type ArchiveFeedbackInput = ArchivedSettingsLocator & {
  undo(): Promise<unknown>;
  onUndoStart?(): void;
  onViewStart?(): void;
};

function notifyStart(callback?: () => void) {
  try { callback?.(); } catch { /* Optional visual feedback cannot block View or Undo. */ }
}

function ArchiveFeedbackContent({
  toastId,
  target,
  undo,
  onView,
  onUndoStart,
  onViewStart,
}: {
  toastId: string | number;
  target: ArchivedSettingsLocator;
  undo(): Promise<unknown>;
  onView(): void;
  onUndoStart?(): void;
  onViewStart?(): void;
}) {
  const { t } = useAppTranslation();
  const [undoing, setUndoing] = useState(false);
  const undoingRef = useRef(false);

  const view = () => {
    notifyStart(onViewStart);
    toast.dismiss(toastId);
    onView();
  };

  const restore = async () => {
    if (undoingRef.current) return;
    undoingRef.current = true;
    notifyStart(onUndoStart);
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
    <FeedbackToast
      data-archive-kind={target.kind}
      data-testid="archive-feedback-toast"
      icon={<Archive />}
      title={t(titleKey[target.kind])}
      onDismiss={() => toast.dismiss(toastId)}
    >
      <FeedbackToastAction
        variant="secondary"
        onClick={view}
      >
        {t("archive.toast.view")}
      </FeedbackToastAction>
      <FeedbackToastAction
        disabled={undoing}
        onClick={() => void restore()}
      >
        {t("archive.toast.undo")}
      </FeedbackToastAction>
    </FeedbackToast>
  );
}

export function useSidebarArchiveFeedback() {
  const navigate = useNavigate();
  return useCallback((input: ArchiveFeedbackInput) => {
    const operation = Symbol("archive");
    playArchiveConfetti(operation);
    const target: ArchivedSettingsLocator = {
      kind: input.kind,
      id: input.id,
    };
    return showFeedbackToast(
      (toastId) => (
        <ArchiveFeedbackContent
          toastId={toastId}
          target={target}
          undo={input.undo}
          onUndoStart={() => { stopArchiveConfetti(operation); notifyStart(input.onUndoStart); }}
          onViewStart={() => { stopArchiveConfetti(operation); notifyStart(input.onViewStart); }}
          onView={() => void navigate(archiveSettingsTargetPath(target))}
        />
      )
    );
  }, [navigate]);
}
