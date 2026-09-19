"use client";

/**
 * [INPUT]: React, shared dialog primitives, menu focus arbitration and host copy/mutations.
 * [OUTPUT]: SidebarRenameDialog and useSidebarRenameMenu with draft retention and deterministic focus handoff.
 * [POS]: Shared Chat/Project rename interaction; hosts own persistence and recoverable errors.
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


export type SidebarRenameDialogProps = {
  copy: { cancel: string; save: string };
  disabled?: boolean;
  closeDisabled?: boolean;
  feedback?: ReactNode;
  open: boolean;
  currentName: string;
  title: ReactNode;
  description: ReactNode;
  maxLength?: number;
  onOpenChange(open: boolean): void;
  onRename(name: string): Promise<unknown>;
  onCloseAutoFocus?(event: Event): void;
};

export function useSidebarRenameMenu(onOpen: (restoreFocus: (event: Event) => void) => void) {
  const menu = usePointerOpenedMenu();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const keyboard = useRef(false);

  const onDialogCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    if (keyboard.current) triggerRef.current?.focus();
  };
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
      onOpen(onDialogCloseAutoFocus);
    },
    onDialogCloseAutoFocus,
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
  copy, disabled, feedback, closeDisabled,
}: SidebarRenameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <SidebarRenameForm
          copy={copy} disabled={disabled} feedback={feedback} closeDisabled={closeDisabled}
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
  copy, disabled, feedback, closeDisabled,
}: Omit<SidebarRenameDialogProps, "open">) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const name = draft.trim();

  const setOpen = (next: boolean) => {
    if (!busyRef.current && !closeDisabled) onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name || busyRef.current || disabled) return;
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
          if (busy || closeDisabled) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy || closeDisabled) event.preventDefault();
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
            <DialogDescription className="mt-3 text-[15px]/[1.4]">
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
            disabled={busy || disabled}
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            className="mt-5 max-md:text-base"
            size="lg"
            onChange={(event) => setDraft(event.target.value)}
          />
          {feedback}
          <DialogFooter className="mt-5 flex-row justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="pill"
              disabled={busy || closeDisabled}
              onClick={() => setOpen(false)}
            >
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="pill"
              disabled={busy || disabled || !name}
            >
              {busy && <Spinner aria-hidden />}
              {copy.save}
            </Button>
          </DialogFooter>
        </form>
    </AppDialogContent>
  );
}
