/**
 * [INPUT]: Depends on scoped transcript/live sources, optional remote controls, virtualized native conversation geometry and portable Chat heads.
 * [OUTPUT]: Renders canonical and live messages without duplication, publishes one bounded model, and reports message/detail intents. Settlement proof retires waiting even before the head catches up.
 * [POS]: conversation/'s root transcript over body/ and timeline/ for desktop and Web; missing pages never imply a complete or empty reply.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ConversationUser } from "./turn/user";
import { ConversationDraft } from "./turn/draft";
import { ConversationActions } from "@ai-chat/ui/components/conversation/actions";
import { ConversationSkeleton } from "@ai-chat/ui/components/conversation/skeleton";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import {
  type CommandSink,
  type LiveTurnSource,
  type TranscriptSource,
} from "../../platform/contracts";
import type { ChatLiveView } from "../../platform/model";
import { TranscriptSession } from "../../platform/transcript-session";
import { chatCopy } from "../../i18n/copy";
import { useComposerTranslation } from "../composer/controls/copy/translation";
import { TranscriptMessage } from "./body/message";
import { LiveReply } from "./body/live";
import { ImportedMessage } from "./body/imported/message";
import { createOutlineFeed } from "../../platform/transcript/outline";
import { useIsMobile } from "@ai-chat/ui/hooks/use-mobile";
import type { CanonicalOutlineItem } from "./timeline/outline-model";
import { ChatOutline } from "./timeline/outline";
import { TimelineView } from "./timeline/view";
import type { TranscriptItem } from "../../platform/transcript-session";
import type { RemoteInteractionControls } from "../remote/turn/interactions";
import { ForkBoundary, type LineageNavigation } from "./lineage/fork";
import { useConversationModelPublisher } from "./body/model";
import type { ImageIdentity } from "../side-panel/image/identity";
import { TranscriptFind } from "../page/navigation/find";
import { findTranslation } from "../page/navigation/find-copy";
import { createTranscriptFind } from "../../platform/transcript/find";
const UserMessageEditor = lazy(() => import("./interactions/edit").then(module => ({ default: module.UserMessageEditor })));
export function ChatTranscript({
  head,
  source,
  live,
  locale = "en",
  targetMessageId,
  findEnabled = true,
  outlineEnabled = true,
  remote,
  onCanonicalCommands,
  onCompletedPlan,
  lineage,
  onOpenImage,
  onFork,
  onEdit,
  remoteFailure,
  onOpenSubagent, onOpenPlan, expandedPlanId, queuedCommandIds,
}: {
  findEnabled?: boolean;
  outlineEnabled?: boolean;
  head: CloudChatHead;
  source: TranscriptSource;
  live: LiveTurnSource;
  commands?: Pick<CommandSink, "available">;
  locale?: string;
  targetMessageId?: string | null;
  lineage?: LineageNavigation;
  remote?: RemoteInteractionControls;
  onCanonicalCommands?(commandIds: string[]): void;
  onCompletedPlan?(messageId: string | null): void;
  onOpenImage?(identity: ImageIdentity): void;
  onOpenSubagent?(id: string): void;
  onOpenPlan?(id: string): void;
  expandedPlanId?: string | null;
  queuedCommandIds?: readonly string[];
  onEdit?(messageId: string, content: string): Promise<void>;
  onFork?: { label: string; run(anchor: { id: string; seq: number }): void };
  /** A Chat another computer runs: its failed turns are said on the message, naming that computer (see TranscriptMessage). */
  remoteFailure?: { computer: string };
}) {
  const copy = useMemo(() => chatCopy(locale), [locale]),
    chatId = head.chat.id;
  const editTranslation = useComposerTranslation(locale);
  const [editing, setEditing] = useState<string | null>(null);
  // Titles, presence and queue publication do not invalidate immutable transcript pages.
  const search = useMemo(() => createTranscriptFind(head, source), [head.chat.id, head.chat.incarnationId, head.bodyRevision, source]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The canonical outline is read when the Chat opens, and after a new body revision only when someone reaches for it (A-08);
     a narrow screen, where the rail is hardly usable, reads none and shows the loaded window. */
  const outline = useMemo(() => createOutlineFeed(source), [head.chat.id, head.chat.incarnationId, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const narrow = useIsMobile(), canonicalOutline = outlineEnabled && !narrow;
  const [outlineState, setOutline] = useState<{ reader: typeof outline; items: CanonicalOutlineItem[] } | null>(null);
  const outlineSignal = useRef<AbortSignal | null>(null);
  useEffect(() => { outline.setHead(head); }, [outline, head]);
  const refreshOutline = useCallback((signal: AbortSignal) => {
    void outline.refresh(signal).then(items => { if (items && !signal.aborted) setOutline({ reader: outline, items }); }).catch(() => {});
  }, [outline]);
  useEffect(() => {
    if (!canonicalOutline) return;
    const abort = new AbortController(); outlineSignal.current = abort.signal; refreshOutline(abort.signal);
    return () => { abort.abort(); outlineSignal.current = null; };
  }, [outline, canonicalOutline, refreshOutline]);
  const outlineIntent = useCallback(() => {
    const signal = outlineSignal.current; if (signal && outline.stale()) refreshOutline(signal);
  }, [outline, refreshOutline]);
  const findT = useMemo(() => findTranslation(locale), [locale]);
  const session = useMemo(
    () => new TranscriptSession(chatId, source, targetMessageId, head.chat.incarnationId),
    [chatId, source, targetMessageId, head.chat.incarnationId],
  );
  const value = useSyncExternalStore(
    session.subscribe,
    session.snapshot,
    session.snapshot,
  );
  const [liveValue, setLiveValue] = useState<{
    chatId: string;
    source: LiveTurnSource;
    draft: ChatLiveView | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    session.open();
    return () => session.close();
  }, [session]);
  useEffect(() => session.setHead(head), [session, head]);
  useEffect(
    () =>
      live.attach(
        chatId,
        (draft) => setLiveValue({ chatId, source: live, draft, error: false }),
        () =>
          setLiveValue((previous) => ({
            chatId,
            source: live,
            draft:
              previous?.chatId === chatId && previous.source === live
                ? previous.draft
                : null,
            error: true,
          })),
      ),
    [live, chatId],
  );
  const currentLive =
    liveValue?.chatId === chatId && liveValue.source === live
      ? liveValue
      : null;
  const draft = currentLive?.draft ?? {
    state: null,
    projection: null,
    contentReady: false,
    replayComplete: false,
  };
  const canonicalReady = Boolean(
    draft.state &&
    value.items.some(
      (item) =>
        item.kind === "native" &&
        item.body.message.id === draft.state!.receipt.assistantMessageId &&
        item.body.message.role === "assistant" &&
        item.body.message.resultHash === draft.state!.receipt.resultHash,
    ),
  );
  // Mirrors LiveReply's own visibility, so "a reply is in progress" never shows for a reply that is already settled.
  const replying = Boolean(draft.state && !(draft.state.receipt.settlementState === "settled" && (draft.state.receipt.resultKind === "empty" || canonicalReady)));
  const model = useConversationModelPublisher();
  const publishedWindow = useMemo(() => ({
    bodies: value.items.flatMap(item => item.kind === "native" ? [item.body] : []),
    segments: value.items.map(item => ({ kind: item.kind, id: item.kind === "native" ? item.body.message.id : item.entry.entryVersionId })),
  }), [value.items]);
  useEffect(() => {
    model?.publish({ chatId, incarnationId: head.chat.incarnationId, ...publishedWindow,
      live: currentLive?.draft ?? null, ready: !value.busy && value.state === "ready", hasEarlier: value.canEarlier,
      latest: value.latest, canonicalReady, liveError: currentLive?.error ?? false });
  }, [model, chatId, head.chat.incarnationId, publishedWindow, value.busy, value.state, value.canEarlier, value.latest, currentLive, canonicalReady]);
  const lastUser = value.items.filter(item => item.kind === "native" && item.body.message.role === "user").at(-1);
  const latestMessage = value.items.filter(item => item.kind === "native").at(-1);
  const finalPlan = latestMessage?.kind === "native" && latestMessage.body.message.role === "assistant" &&
    latestMessage.body.message.kind === "plan" && !latestMessage.body.message.isError && latestMessage.body.message.completion !== "interrupted" && !head.openTurnId && !replying ? latestMessage.body.message.id : null;
  useEffect(() => { onCompletedPlan?.(finalPlan); }, [finalPlan, onCompletedPlan]);
  const canonicalCommands = useMemo(
    () =>
      value.items.flatMap((item) =>
        item.kind === "native" &&
        item.body.message.role === "user" &&
        item.body.message.remoteCommandId
          ? [item.body.message.remoteCommandId]
          : [],
      ),
    [value.items],
  );
  useEffect(() => {
    onCanonicalCommands?.(canonicalCommands);
  }, [canonicalCommands, onCanonicalCommands]);
  const queuedCommands = new Set([...(head.queue?.items.map(item => item.intentId) ?? []), ...(queuedCommandIds ?? [])]);
  const pendingMessages = remote?.entries.filter(entry => (entry.optimistic || entry.owned) && !entry.canonical && !entry.resubmittedAs && !entry.rejected &&
    !canonicalCommands.includes(entry.input.commandId) && !queuedCommands.has(entry.input.commandId) && entry.input.payload.kind === "start-turn" &&
    !(!entry.receipt?.admission && ["rejected", "expired", "cancelled"].includes(entry.receipt?.state ?? ""))) ?? [];
  const settledTurn = draft.state?.receipt.settlementState === "settled" ? draft.state.receipt : null;
  const unansweredCommand = latestMessage?.kind === "native" && latestMessage.body.message.role === "user" && latestMessage.body.message.id !== settledTurn?.userMessageId ? latestMessage.body.message.remoteCommandId : null;
  const pendingCommands = new Set(pendingMessages.map(entry => entry.input.commandId));
  const openTurn = head.openTurnId && head.openTurnId !== settledTurn?.turnId;
  const waitingForReply = !replying && (Boolean(openTurn) || remote?.entries.some(entry => (pendingCommands.has(entry.input.commandId) || entry.input.commandId === unansweredCommand) && !entry.uncertain &&
    !["done", "error", "cancelled", "rejected", "expired", "outcome-unknown"].includes(entry.receipt?.state ?? "")));
  // A body can arrive before its settlement proof. Keep the live row until the two agree, then replace it once.
  const retainedLiveId = replying ? draft.state?.receipt.assistantMessageId : undefined;
  const messages = useMemo(() => timelineRows(value.items.filter(item => item.kind !== "native" || item.body.message.id !== retainedLiveId)), [value.items, retainedLiveId]);
  const earlier = useCallback(async () => { await session.earlier(); return timelineRows(session.snapshot().items); }, [session]);
  const materialize = useCallback(async (id: string) => { await session.seek(id, search.locate(id) ?? outline.locate(id)); return timelineRows(session.snapshot().items); }, [session, search, outline]);
  return (
    <div className="cloud-transcript">
      {head.chat.classification.conversationKind !== "ordinary" && (
        <aside className="chat-readonly-banner">
          {copy.appReadOnly}
          {head.archivedAt !== null ? ` · ${copy.archived}` : ""}
        </aside>
      )}
      <TimelineView key={`${chatId}/${head.chat.incarnationId}`} memoryKey={`${chatId}/${head.chat.incarnationId}`} busy={value.busy} messages={messages} hasMoreBefore={value.canEarlier} earlier={earlier} materialize={materialize}
        routeSearch={targetMessageId ? `?m=${encodeURIComponent(targetMessageId)}` : undefined}
        copy={{ earlier: copy.earlier, loading: copy.loading, imported: copy.imported, loaded: count => `${copy.earlier}: ${count}` }}
        navigation={jumpTo => <>{findEnabled && <TranscriptFind chatId={chatId} find={search.find} t={findT} jumpTo={jumpTo} surfaceVisible />}{outlineEnabled && <ChatOutline canonicalItems={canonicalOutline && outlineState?.reader === outline ? outlineState.items : undefined} onIntent={canonicalOutline ? outlineIntent : undefined} messages={value.items.flatMap(item => item.kind === "native" ? [item.body.message] : [])} label={copy.outline} onJump={jumpTo} />}</>}
        before={<>
          {!value.latest && (
            <button
              className="chat-earlier"
              type="button"
              disabled={value.busy}
              onClick={() => {
                void session.latest();
              }}
            >
              {copy.latest}
            </button>
          )}
          {value.error && (
            <p className="chat-content-status" role="alert">
              {value.items.length ? copy.partial : copy.unavailable}{" "}
              <button type="button" onClick={() => void session.latest()}>
                {copy.retry}
              </button>
            </p>
          )}
          {value.busy && !value.items.length && !pendingMessages.length && !head.openTurnId && <ConversationSkeleton label={copy.loading} />}
          {!value.busy && !value.error && value.state !== "ready" && (
            <p className="chat-content-status" role="status">
              {value.state === "pending"
                ? copy.pending
                : value.state === "partial"
                  ? copy.partial
                  : copy.unavailable}
            </p>
          )}
          {!value.busy &&
            !value.error &&
            value.state === "ready" &&
            !value.canEarlier &&
            !value.items.length && !pendingMessages.length && !head.openTurnId && (
              <p className="chat-content-status">{copy.empty}</p>
            )}
        </>}
        row={({ item }) => <>
                  {item.kind === "native" ? (editing === item.body.message.id && onEdit ?
                    <Suspense fallback={<ConversationUser content={item.body.message.content} showMore={copy.showMore} showLess={copy.showLess} />}><UserMessageEditor key={editing} t={editTranslation} content={item.body.message.content} onCancel={() => setEditing(null)} onSubmit={content => onEdit(item.body.message.id, content)} /></Suspense> : <TranscriptMessage
                      chatId={chatId}
                      onOpenImage={onOpenImage} onOpenSubagent={onOpenSubagent} onOpenPlan={onOpenPlan} expandedPlanId={expandedPlanId}
                      remoteFailure={remoteFailure}
                      body={item.body}
                      onEdit={onEdit && item === lastUser && latestMessage?.kind === "native" && latestMessage.body.message.seq === head.headSeq && !head.openTurnId && item.body.message.segment !== "imported"
                        ? setEditing : undefined} editLabel={editTranslation("chatRevision.edit")}
                      onFork={onFork && item.body.message.role === "assistant" && item.body.message.completion !== "interrupted" ? onFork.run : undefined} forkLabel={onFork?.label}
                      source={source}
                      copy={copy}
                      locale={locale}
                    />
                  ) : (
                    <ImportedMessage
                      chatId={chatId}
                      entry={item.entry}
                      backend={item.backend}
                      content={item.content}
                      source={source}
                      copy={copy}
                      locale={locale}
                    />
                  )}
                  {item.kind === "native" &&
                    head.chat.inheritedThroughSeq === item.body.message.seq && (
                      <ForkBoundary
                        chat={head.chat}
                        source={source}
                        navigation={lineage}
                        locale={locale}
                      />
                    )}
        </>}
        after={<>

          {value.latest && pendingMessages.map(entry => <article key={entry.input.commandId} className="chat-message" data-command-id={entry.input.commandId}>
            <ConversationUser content={entry.input.payload.kind === "start-turn" ? entry.input.payload.text : ""} showMore={copy.showMore} showLess={copy.showLess}
              actions={<ConversationActions role="user" copyLabel={copy.copy} copiedLabel={copy.copied} onCopy={() => navigator.clipboard.writeText(entry.input.payload.kind === "start-turn" ? entry.input.payload.text : "")} />} />
          </article>)}
          {value.latest && waitingForReply && <ConversationDraft label="Thinking" />}
          {/* D-16: the live reply belongs under the newest messages; a reader on an older page is told, and can go back. */}
          {value.latest ? (
            <LiveReply
              value={draft}
              copy={copy}
              canonicalReady={canonicalReady}
              interactive={Boolean(remote)} locale={locale} onOpenSubagent={onOpenSubagent} onOpenPlan={onOpenPlan} expandedPlanId={expandedPlanId}
            />
          ) : replying && (
            <p className="chat-content-status" role="status" data-reply-elsewhere="">
              {copy.replyInProgress}{" "}
              <button type="button" disabled={value.busy} onClick={() => void session.latest()}>{copy.latest}</button>
            </p>
          )}

        </>} />
    </div>
  );
}

function timelineRows(items: TranscriptItem[]) {
  return items.map(item => item.kind === "native" ? { id: item.body.message.id, seq: item.body.message.seq, segment: "native" as const, item } :
    { id: item.entry.entryVersionId, seq: item.entry.deliverySeq, segment: "imported" as const, item });
}
