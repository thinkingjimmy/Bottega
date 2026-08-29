"use client";

/**
 * [INPUT]: Depends on React state/focus primitives, AppDialog/Input/Button/Spinner, desktop i18n, and the pointer-opened menu focus arbiter
 * [OUTPUT]: Provides SidebarRenameDialog and useSidebarRenameMenu for one rename form and deterministic DropdownMenu-to-Dialog focus transfer
 * [POS]: Shared rename interaction in components/sidebar/rename, consumed by Chat, imported History, and Project rows
 */

import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AppDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
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
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export type SidebarRenameDialogProps = {
  open: boolean;
  currentName: string;
  title: ReactNode;
  description: ReactNode;
  maxLength?: number;
  onOpenChange(open: boolean): void;
  onRename(name: string): Promise<unknown>;
  onCloseAutoFocus?(event: Event): void;
};

/* ── 菜单与弹窗之间只有一个焦点主人 ───────────────────────────────
 * Rename 不是在菜单事件里直接挂 Dialog：菜单尚未完成 close autofocus，
 * 此时挂载会让两层 FocusScope 抢同一个焦点。先登记 intent，再由菜单关闭事件
 * 打开弹窗，交接点因此只有一个。关闭弹窗时，键盘回到 More；指针回到 body，
 * 不把 hover action 永久钉在行尾。
 * ────────────────────────────────────────────────────────── */
export function useSidebarRenameMenu(onOpen: () => void) {
  const menu = usePointerOpenedMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const keyboard = useRef(false);

  return {
    triggerProps: {
      ref: triggerRef,
      onPointerDown: () => {
        keyboard.current = false;
        menu.triggerProps.onPointerDown();
      },
      onKeyDown: () => {
        keyboard.current = true;
        menu.triggerProps.onKeyDown();
      },
    },
    requestOpen: () => {
      pending.current = true;
    },
    onMenuCloseAutoFocus: (event: Event) => {
      if (!pending.current) {
        menu.onCloseAutoFocus(event);
        return;
      }
      pending.current = false;
      event.preventDefault();
      onOpen();
    },
    onDialogCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (keyboard.current) triggerRef.current?.focus();
    },
  };
}

export function SidebarRenameDialog({
  open,
  currentName,
  title,
  description,
  maxLength = 200,
  onOpenChange,
  onRename,
  onCloseAutoFocus,
}: SidebarRenameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <SidebarRenameForm
          currentName={currentName}
          description={description}
          maxLength={maxLength}
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenChange={onOpenChange}
          onRename={onRename}
          title={title}
        />
      )}
    </Dialog>
  );
}

function SidebarRenameForm({
  currentName,
  title,
  description,
  maxLength,
  onOpenChange,
  onRename,
  onCloseAutoFocus,
}: Omit<SidebarRenameDialogProps, "open">) {
  const { t } = useAppTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const name = draft.trim();

  const setOpen = (next: boolean) => {
    if (!busyRef.current) onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || busyRef.current) return;
    if (name === currentName.trim()) {
      onOpenChange(false);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onRename(name);
      onOpenChange(false);
    } catch {
      // Provider owns the user-facing error; keep this draft open for retry.
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AppDialogContent
        aria-busy={busy}
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <form onSubmit={submit}>
          <DialogHeader className="text-left">
            <DialogTitle className="text-xl/7 font-semibold">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-2 text-sm/5">
              {description}
            </DialogDescription>
          </DialogHeader>
          <label className="sr-only" htmlFor={inputId}>
            {title}
          </label>
          <Input
            ref={inputRef}
            id={inputId}
            value={draft}
            maxLength={maxLength}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="my-5 text-base"
            onChange={(event) => setDraft(event.target.value)}
          />
          <DialogFooter className="flex-row justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="pill"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="pill"
              disabled={busy || !name}
            >
              {busy && <Spinner aria-hidden />}
              {busy ? t("common.loading") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
    </AppDialogContent>
  );
}
