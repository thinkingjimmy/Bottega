/**
 * [INPUT]: Depends on shared message action primitives and caller-owned clipboard, edit/fork capabilities, labels, timestamps and optional actions.
 * [OUTPUT]: Provides ConversationActions and ConversationDownload with common edit/fork controls, mirrored alignment, hover/keyboard visibility and single-flight copy feedback.
 * [POS]: Common action row for native, remote and imported messages; platform capabilities stay with the caller.
 */
import { ArrowsSplitIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, GitForkIcon, PencilIcon } from "lucide-react";
import { MessageAction, MessageActions } from "../ai-elements/message";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type ConversationCommand = {
  label: string;
  onClick?: () => void;
  disabledReason?: string;
};
function CommandAction({ action, children }: { action?: ConversationCommand; children: ReactNode }) {
  if (!action || (!action.onClick && !action.disabledReason)) return null;
  return <MessageAction
    className={action.disabledReason ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
    disabled={Boolean(action.disabledReason)}
    label={action.disabledReason ?? action.label}
    tooltip={action.disabledReason ?? action.label}
    onClick={action.onClick}
  >{children}</MessageAction>;
}

export function ConversationActions({
  role,
  onCopy,
  copyLabel,
  copiedLabel,
  timestamp,
  edit,
  fork,
  children,
  suffix,
}: {
  role: "user" | "assistant";
  onCopy?: () => void | Promise<void>;
  copyLabel: string;
  copiedLabel: string;
  timestamp?: ReactNode;
  edit?: ConversationCommand;
  fork?: ConversationCommand;
  children?: ReactNode;
  suffix?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(resetTimer.current);
    };
  }, []);
  async function copy() {
    if (copyingRef.current || !onCopy) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      await onCopy();
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      if (mounted.current) setCopied(false);
    } finally {
      copyingRef.current = false;
      if (mounted.current) setCopying(false);
    }
  }
  return (
    <MessageActions
      data-slot="conversation-actions"
      className={cn(
        "opacity-0 transition-opacity has-[:focus-visible]:opacity-100 group-hover:opacity-100 no-hover:opacity-100 max-md:opacity-100 max-md:[&>button]:size-11 max-md:[&>a]:size-11",
        role === "user" && "ml-auto flex-row-reverse",
      )}
    >
      {onCopy && (
        <MessageAction
          className="cursor-pointer"
          label={copied ? copiedLabel : copyLabel}
          tooltip={copied ? copiedLabel : copyLabel}
          disabled={copying}
          aria-busy={copying || undefined}
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </MessageAction>
      )}
      <CommandAction action={edit}><PencilIcon /></CommandAction>
      <CommandAction action={fork}><GitForkIcon /></CommandAction>
      {children}
      {timestamp && (
        <span className="text-muted-foreground text-xs">{timestamp}</span>
      )}
      {suffix}
    </MessageActions>
  );
}

export function ConversationDownload({
  href,
  filename,
  label,
}: {
  href: string;
  filename: string;
  label: string;
}) {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <a href={href} download={filename} aria-label={label} title={label}>
        <DownloadIcon />
      </a>
    </Button>
  );
}

export function ConversationForkIcon({ className }: { className?: string }) {
  return <ArrowsSplitIcon className={className} weight="regular" />;
}
