"use client";

/**
 * [INPUT]: Depends on React, router, Apps i18n, AppsProvider, cloud conversion review, and AppDialog form primitives.
 * [OUTPUT]: Provides original-request conversion replay, classification comparison and retryable keep-original decisions, with uncertainty explained above frozen fields.
 * [POS]: Sole Base-to-App conversion form shared by full pages, panels, and the Sidebar
 */

import { useCallback, useRef, useState } from "react";
import { ConversionStatus, useConversionReview } from "./save/cloud-review";
import { useNavigate } from "react-router";
import {
  AppDialogBody,
  AppDialogContent,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { useApps } from "@/components/providers/apps-provider";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { SaveAsAppRejectedError } from "@/lib/apps-client";
import type { SaveAsAppInput } from "../../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { ConversionReview } from "../../../../shared/cloud/conversion/model";

const ICONS = ["📦", "📊", "🧭", "🗂️", "💡", "🧰"] as const;
type SaveAttempt = Readonly<{ input: Readonly<SaveAsAppInput> }>;
const pendingAttempts = new Map<string, SaveAttempt>();

export function SaveAsAppDialog({
  open,
  chatId,
  defaultName,
  onOpenChange,
}: {
  chatId: string;
  defaultName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [attempt, setAttemptState] = useState<SaveAttempt | null>(
    () => pendingAttempts.get(chatId) ?? null
  );
  const activeAttempt =
    attempt?.input.chatId === chatId
      ? attempt
      : pendingAttempts.get(chatId) ?? null;
  const setAttempt = useCallback((next: SaveAttempt | null) => {
    if (next) pendingAttempts.set(chatId, next);
    else pendingAttempts.delete(chatId);
    setAttemptState(next);
  }, [chatId]);
  if (!open) return null;
  return (
    <OpenSaveAsAppDialog
      attempt={activeAttempt}
      chatId={chatId}
      defaultName={defaultName}
      key={chatId}
      onAttemptChange={setAttempt}
      onOpenChange={onOpenChange}
      open
    />
  );
}

function OpenSaveAsAppDialog({
  attempt,
  chatId,
  defaultName,
  open,
  onAttemptChange,
  onOpenChange,
}: {
  attempt: SaveAttempt | null;
  chatId: string;
  defaultName: string;
  open: boolean;
  onAttemptChange: (attempt: SaveAttempt | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { saveAsApp } = useApps();
  const [name, setName] = useState(attempt?.input.name ?? defaultName);
  const [icon, setIcon] = useState<(typeof ICONS)[number]>(
    (attempt?.input.icon as (typeof ICONS)[number]) ?? "📦"
  );
  const [busy, setBusy] = useState(false);
  const [decisionFailed, setDecisionFailed] = useState(false);
  const [error, setError] = useState(
    attempt ? t("apps.saveAs.uncertain") : ""
  );
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const receiveReview = useCallback((review: ConversionReview | null) => {
    const restored = review?.input;
    if (restored) {
      onAttemptChange({ input: Object.freeze(restored) }); setName(restored.name); setIcon(restored.icon as (typeof ICONS)[number]);
    }
  }, [onAttemptChange]);
  const conversion = useConversionReview(chatId, receiveReview);
  const keepOriginal = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setDecisionFailed(false);
    try { await conversion.keepOriginal(); onAttemptChange(null); requestAnimationFrame(() => nameInput.current?.focus()); }
    catch { setDecisionFailed(true); setError(t("apps.saveAs.cloud.reviewFailed")); }
    finally { submitting.current = false; setBusy(false); }
  };

  const submit = async () => {
    if (submitting.current || conversion.checking || conversion.failed || conversion.review?.state === "conflicted") return;
    const normalized = name.trim();
    if (!attempt && !normalized) {
      setError(t("apps.saveAs.enterName"));
      return;
    }
    const current =
      attempt ??
      Object.freeze({
        input: Object.freeze({
          chatId,
          name: normalized,
          icon,
          requestId: crypto.randomUUID(),
        }),
      } satisfies SaveAttempt);
    if (!attempt) onAttemptChange(current);
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const record = await saveAsApp(current.input);
      onAttemptChange(null);
      onOpenChange(false);
      navigate(`/apps/${record.id}`);
    } catch (cause) {
      if (cause instanceof SaveAsAppRejectedError) {
        onAttemptChange(null);
      }
      setError(errorMessage(cause, t("apps.saveAs.failed")));
      await conversion.refresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  // Explain a frozen replay before the fields the user cannot edit.
  const frozen = Boolean(attempt);
  const errorNode = error && (decisionFailed || !conversion.review) ? (
    <p className="text-[13px]/[1.45] text-destructive" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AppDialogContent aria-busy={busy || conversion.checking}>
        <DialogHeader className="mb-5 shrink-0 gap-0 text-left">
          <DialogTitle className="text-xl/7 font-semibold">
            {t("apps.saveAs.title")}
          </DialogTitle>
          <DialogDescription className="mt-3 text-[15px]/[1.4]">
            {t("apps.saveAs.description")}
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="flex flex-col gap-4">
          {frozen && errorNode}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px]/[1.45] font-medium text-muted-foreground">
              {t("apps.saveAs.name")}
            </span>
            <Input
              ref={nameInput}
              autoFocus
              size="lg"
              disabled={busy || conversion.checking || frozen}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px]/[1.45] font-medium text-muted-foreground">
              {t("apps.saveAs.icon")}
            </legend>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((candidate) => (
                <Button
                  aria-label={t("apps.saveAs.chooseIcon", { icon: candidate })}
                  aria-pressed={icon === candidate}
                  className={cn(
                    "size-10 rounded-xl text-xl",
                    icon === candidate && "border-foreground/40"
                  )}
                  disabled={busy || conversion.checking || frozen}
                  key={candidate}
                  onClick={() => setIcon(candidate)}
                  size="icon"
                  type="button"
                  variant={icon === candidate ? "secondary" : "outline"}
                >
                  {candidate}
                </Button>
              ))}
            </div>
          </fieldset>
          {conversion.review && <ConversionStatus review={conversion.review} busy={busy || conversion.checking} keepOriginal={() => void keepOriginal()} />}
          {conversion.failed && <p role="alert" className="text-destructive text-sm">{t("apps.saveAs.cloud.reviewFailed")}</p>}
          {!frozen && errorNode}
        </AppDialogBody>
        <DialogFooter className="mt-5 shrink-0 sm:gap-3">
          <Button
            className="text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            size="pill"
            type="button"
            variant="ghost"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || conversion.checking || !name.trim() || conversion.review?.state === "conflicted"}
            onClick={() => conversion.failed ? void conversion.refresh() : void submit()}
            size="pill"
          >
            {busy && <Spinner />}
            {conversion.review || conversion.failed ? t("apps.saveAs.cloud.retry") : t("apps.saveAs.submit")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
