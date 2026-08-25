"use client";

/**
 * [INPUT]: Depends on React, react-router, AppsProvider and Unified AppDialogContent/Input/Button
 * [OUTPUT]: Provides SaveAsAppDialog; Operating terminal clearance attempt, transfers of the disambiguation across unloading freeze and re-install the complete requestId+payload
 * [POS]: The Base→App unique table of the apps module; Modular attempt book unit page, panel and Sidebar
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
import { useApps } from "@/components/providers/apps-provider";
import { errorMessage } from "@/lib/errors";
import { SaveAsAppRejectedError } from "@/lib/apps-client";
import type { SaveAsAppInput } from "../../../shared/apps-ipc";

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
  const navigate = useNavigate();
  const { saveAsApp } = useApps();
  const [name, setName] = useState(attempt?.input.name ?? defaultName);
  const [icon, setIcon] = useState<(typeof ICONS)[number]>(
    (attempt?.input.icon as (typeof ICONS)[number]) ?? "📦"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    attempt ? "上次提交结果未知，只能用原参数重试确认。" : ""
  );
  const submitting = useRef(false);

  const submit = async () => {
    if (submitting.current) return;
    const normalized = name.trim();
    if (!attempt && !normalized) {
      setError("请输入 App 名称");
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
      setError(errorMessage(cause, "Save as App 失败"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AppDialogContent aria-busy={busy}>
        <DialogHeader className="shrink-0 text-left">
          <DialogTitle>Save as App</DialogTitle>
          <DialogDescription>
            将创建 App：当前 Base 升级为 App 共享数据，本 chat 转为它的编辑会话。
          </DialogDescription>
        </DialogHeader>
        <AppDialogBody className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">名称</span>
            <Input
              autoFocus
              disabled={busy || Boolean(attempt)}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="font-medium text-sm">图标</legend>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((candidate) => (
                <Button
                  aria-label={`选择图标 ${candidate}`}
                  aria-pressed={icon === candidate}
                  className="text-lg"
                  disabled={busy || Boolean(attempt)}
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
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </AppDialogBody>
        <DialogFooter className="mt-5 shrink-0">
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            取消
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => void submit()}>
            {busy ? "正在创建…" : "Save as App"}
          </Button>
        </DialogFooter>
      </AppDialogContent>
    </Dialog>
  );
}
