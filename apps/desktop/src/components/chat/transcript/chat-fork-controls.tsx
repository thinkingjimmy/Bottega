/**
 * [INPUT]: Depends on strict fork contracts, bounded Chat reads/commands, localized dialog primitives, Phosphor icons, and the shared transcript divider
 * [OUTPUT]: Provides fork lineage navigation and a direct-choice same-workspace/managed-worktree fork dialog
 * [POS]: Fork-specific transcript interaction sibling; ChatTranscript decides eligibility and owns the selected anchor
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowsSplitIcon } from "@phosphor-icons/react";
import type {
  AssistantChatMessage,
  ChatForkMode,
  ChatSummary,
  ForkChatPreflight,
} from "../../../../shared/chats-ipc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage, failureCode } from "@/lib/errors";
import {
  forkChat,
  getChatTimelineAround,
  preflightChatFork,
} from "@/lib/chats-client";
import { TranscriptDividerRow } from "./transcript-divider";

export type ChatForkViewContext = Readonly<{
  summary: ChatSummary;
  parent: ChatSummary | null;
  navigateToChat: (chatId: string, messageId?: string) => void;
}>;

/* main 只抛稳定机器码；对照 PRD §9 在这一处翻成人话，未列出的码走通用剥码文案。 */
const FORK_FAILURE_COPY = {
  CHAT_FORK_ANCHOR_INELIGIBLE: "errors.pointInvalid",
  CHAT_FORK_PREFIX_HAS_NO_USER: "errors.pointInvalid",
  CHAT_FORK_SOURCE_STALE: "errors.sourceStale",
  CHAT_FORK_SOURCE_INELIGIBLE: "errors.sourceUnsupported",
  CHAT_FORK_PREFIX_TOO_LARGE: "errors.prefixTooLarge",
  CHAT_FORK_SOURCE_MISSING: "errors.projectUnavailable",
  CHAT_FORK_SOURCE_PROJECT_CHANGED: "errors.projectUnavailable",
  PROJECT_UNAVAILABLE: "errors.projectUnavailable",
  CHAT_FORK_REQUEST_CONFLICT: "errors.requestConflict",
  CHAT_FORK_CHILD_EXISTS: "errors.requestConflict",
  CHAT_FORK_HOME_RECOVERY_REQUIRED: "errors.recoveryRequired",
  GIT_SANDBOX_UNAVAILABLE: "unsupported",
  WORKTREE_NOT_GIT_REPOSITORY: "errors.notRepository",
  WORKTREE_NOT_GIT_ROOT: "errors.notGitRoot",
  WORKTREE_NO_HEAD: "errors.noHead",
  GIT_BARE_REPOSITORY: "errors.bareRepository",
  GIT_OPERATION_IN_PROGRESS: "errors.operationInProgress",
  GIT_SUBMODULE_UNSUPPORTED: "errors.submodule",
  GIT_TREE_SCAN_TRUNCATED: "errors.treeTooLarge",
  GIT_CONFIG_FILTER_DRIVER: "errors.configUnsafe",
  GIT_CONFIG_EXTERNAL_FSMONITOR: "errors.configUnsafe",
  GIT_CONFIG_ALTERNATE_REFS_COMMAND: "errors.configUnsafe",
  WORKTREE_BRANCH_EXISTS: "errors.branchConflict",
  WORKTREE_PATH_CONFLICT: "errors.pathConflict",
  WORKTREE_IDENTITY_MISMATCH: "errors.identityDrift",
  GIT_IDENTITY_DRIFT: "errors.identityDrift",
} as const;

type PreflightResult = Readonly<{
  key: string;
  value?: ForkChatPreflight;
  error?: string;
}>;

function ForkChoice({
  busy,
  detail,
  disabled,
  error,
  loading,
  onSelect,
  title,
}: {
  busy: boolean;
  detail: string;
  disabled: boolean;
  error?: string;
  loading: boolean;
  onSelect: () => void;
  title: string;
}) {
  return (
    <button
      aria-label={title}
      className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left outline-none transition-colors enabled:hover:bg-muted/60 enabled:focus-visible:bg-muted/60 enabled:focus-visible:ring-2 enabled:focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="mt-2.5 grid size-5 -translate-x-0.5 shrink-0 place-items-center text-foreground/65" aria-hidden="true">
        {loading || busy
          ? <Spinner className="size-4" />
          : <ArrowsSplitIcon className="size-4 -rotate-90" weight="regular" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px]/5 font-normal tracking-[-0.01em] text-foreground">{title}</span>
        <span
          className={error ? "mt-0.5 block text-xs/5 text-destructive" : "mt-0.5 block text-xs/5 text-muted-foreground"}
          role={error ? "alert" : undefined}
        >
          {error ?? detail}
        </span>
      </span>
    </button>
  );
}

export function ForkLineageDivider({ context }: { context: ChatForkViewContext }) {
  const { t } = useAppTranslation();
  const { summary, parent } = context;
  const lineageKey = parent && summary.parentMessageId && summary.parentIncarnationId
    ? `${parent.id}:${summary.parentIncarnationId}:${summary.parentMessageId}`
    : null;
  const [verifiedKey, setVerifiedKey] = useState<string | null>(() => lineageKey);
  const available = Boolean(lineageKey && verifiedKey === lineageKey);
  useEffect(() => {
    if (!parent || !summary.parentMessageId || !summary.parentIncarnationId || !lineageKey) return;
    let live = true;
    void getChatTimelineAround({
      chatId: parent.id,
      messageId: summary.parentMessageId,
      radius: 1,
    }).then((page) => {
      const exact = page?.incarnationId === summary.parentIncarnationId &&
        page?.messages.some((message) => message.id === summary.parentMessageId);
      if (live) setVerifiedKey(exact ? lineageKey : null);
    }).catch(() => { if (live) setVerifiedKey(null); });
    return () => { live = false; };
  }, [lineageKey, parent, summary.parentIncarnationId, summary.parentMessageId]);
  return (
    <TranscriptDividerRow role="separator">
      <button
        aria-label={available && parent
          ? t("chat.fork.openSource", { title: parent.title ?? t("chat.newTask") })
          : t("chat.fork.originalUnavailable")}
        className="min-h-11 rounded-full px-3 py-1 transition-colors enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        data-fork-divider=""
        disabled={!available}
        onClick={() => context.navigateToChat(parent!.id, summary.parentMessageId!)}
        type="button"
      >
        {t("chat.fork.continuedFrom")}
      </button>
    </TranscriptDividerRow>
  );
}

export function ForkChatDialog({
  anchor,
  context,
  onClose,
}: {
  anchor: AssistantChatMessage;
  context: ChatForkViewContext;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const [preflights, setPreflights] = useState<Partial<Record<ChatForkMode, PreflightResult>>>({});
  const [busyMode, setBusyMode] = useState<ChatForkMode | null>(null);
  const [submitError, setSubmitError] = useState<{ mode: ChatForkMode; message: string } | null>(null);
  const failureText = useCallback((cause: unknown) => {
    const copy = FORK_FAILURE_COPY[failureCode(cause) as keyof typeof FORK_FAILURE_COPY];
    return copy ? t(`chat.fork.${copy}`) : errorMessage(cause, t("chat.fork.unavailable"));
  }, [t]);
  const [identity] = useState(() => ({
    requestId: `fork_${crypto.randomUUID().replaceAll("-", "")}`,
    childChatId: `chat_${crypto.randomUUID().replaceAll("-", "")}`,
  }));
  const base = useMemo(() => ({
    sourceChatId: context.summary.id,
    sourceIncarnationId: context.summary.incarnationId!,
    anchorMessageId: anchor.id,
    anchorSeq: anchor.seq,
  }), [anchor.id, anchor.seq, context.summary.id, context.summary.incarnationId]);
  const preflightKey = JSON.stringify(base);
  useEffect(() => {
    let live = true;
    const load = (mode: ChatForkMode) => {
      void preflightChatFork({ ...base, mode })
        .then((value) => {
          if (live) setPreflights((current) => ({
            ...current,
            [mode]: { key: preflightKey, value },
          }));
        })
        .catch((cause) => {
          if (live) setPreflights((current) => ({
            ...current,
            [mode]: { key: preflightKey, error: failureText(cause) },
          }));
        });
    };
    load("same-workspace");
    load("new-worktree");
    return () => { live = false; };
  }, [base, failureText, preflightKey]);
  const resultFor = (mode: ChatForkMode) => preflights[mode]?.key === preflightKey
    ? preflights[mode]
    : undefined;
  const submit = async (mode: ChatForkMode) => {
    setBusyMode(mode);
    setSubmitError(null);
    try {
      const child = await forkChat({ ...identity, ...base, mode });
      context.navigateToChat(child.id);
      onClose();
    } catch (cause) {
      setSubmitError({ mode, message: failureText(cause) });
    } finally {
      setBusyMode(null);
    }
  };
  const sameWorkspace = resultFor("same-workspace");
  const newWorktree = resultFor("new-worktree");
  const dirty = newWorktree?.value?.worktree?.dirty;
  const sourceDirty = dirty && (dirty.staged || dirty.unstaged || dirty.untracked || dirty.ignored);
  const newWorktreeUnsupported = newWorktree?.value?.worktree?.supported === false;
  const busy = busyMode !== null;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="w-[min(calc(100%-2rem),420px)] gap-0 rounded-[22px] p-5 shadow-2xl sm:max-w-[420px]"
        overlayClassName="bg-black/15 backdrop-blur-[1px]"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-xl/7 font-semibold tracking-[-0.025em]">{t("chat.fork.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("chat.fork.description", { title: context.summary.title ?? t("chat.newTask") })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid gap-0">
          <ForkChoice
            busy={busyMode === "same-workspace"}
            detail={t("chat.fork.sameWorkspaceDetail")}
            disabled={busy || !sameWorkspace?.value}
            error={submitError?.mode === "same-workspace" ? submitError.message : sameWorkspace?.error}
            loading={!sameWorkspace}
            onSelect={() => void submit("same-workspace")}
            title={t("chat.fork.sameWorkspace")}
          />
          <ForkChoice
            busy={busyMode === "new-worktree"}
            detail={sourceDirty
              ? t("chat.fork.dirtyWarning")
              : newWorktreeUnsupported
                ? t("chat.fork.unsupported")
                : t("chat.fork.newWorktreeDetail")}
            disabled={busy || !newWorktree?.value || newWorktreeUnsupported}
            error={submitError?.mode === "new-worktree" ? submitError.message : newWorktree?.error}
            loading={!newWorktree}
            onSelect={() => void submit("new-worktree")}
            title={t("chat.fork.newWorktree")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
