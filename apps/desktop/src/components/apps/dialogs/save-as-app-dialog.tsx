"use client";

/**
 * [INPUT]: Depends on React, router, Apps i18n, AppsProvider, and AppDialog form primitives
 * [OUTPUT]: Provides SaveAsAppDialog with durable ambiguous-attempt replay using the exact requestId and payload, explained above the fields it freezes
 * [POS]: Sole Base-to-App conversion form shared by full pages, panels, and the Sidebar
 */

import { useRef, useState } from "react";
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
import { errorMessage } from "@/lib/errors";
import { SaveAsAppRejectedError } from "@/lib/apps-client";
import type { SaveAsAppInput } from "../../../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  const setAttempt = (next: SaveAttempt | null) => {
    if (next) pendingAttempts.set(chatId, next);
    else pendingAttempts.delete(chatId);
    setAttemptState(next);
  };
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
  const [error, setError] = useState(
    attempt ? t("apps.saveAs.uncertain") : ""
  );
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current) return;
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
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  /* 冻结态的解释要落在被冻结的东西上面。重放态把名称与图标一起锁死，而
     唯一的说明此前是弹窗**底部**一行红字——读者读到它之前，人已经在点那个
     点不动的输入框了。 */
  const frozen = Boolean(attempt);
  const errorNode = error ? (
    <p className="text-[13px]/[1.45] text-destructive" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AppDialogContent aria-busy={busy}>
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
              autoFocus
              size="lg"
              disabled={busy || frozen}
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
                  /* 28px 方格里 18px 的字面图形，六个挨在一起——选中与未选中
                     只差一层 secondary 浅灰底，在这套无强调色的配色里几乎读不
                     出来。方格放到 40px，选中态在填色之外再加一道前景描边。 */
                  className={cn(
                    "size-10 rounded-xl text-xl",
                    icon === candidate && "border-foreground/40"
                  )}
                  disabled={busy || frozen}
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
          {/* 忙态只加一颗 spinner，文案一个字不动：换成「Creating…」会让按钮
              在按下的那一刻改变宽度，整排页脚跟着抖一下。 */}
          <Button
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
            size="pill"
          >
            {busy && <Spinner />}
            {t("apps.saveAs.submit")}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
