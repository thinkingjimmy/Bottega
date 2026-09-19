/**
 * [INPUT]: Depends on scoped transcript/live sources, optional remote controls, virtualized native conversation geometry and portable Chat heads.
 * [OUTPUT]: Renders the transcript, publishes its bounded conversation model and provenance, and reports image intents, canonical commands and completed Plan identity.
 * [POS]: conversation/'s root transcript over body/ and timeline/ for desktop and Web; missing pages never imply a complete or empty reply.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
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
import { UserMessageEditor } from "./interactions/edit";
import { useComposerTranslation } from "../composer/controls/copy/translation";
import { TranscriptMessage } from "./body/message";
import { LiveReply } from "./body/live";
import { ImportedMessage } from "./body/imported/message";
import { createTranscriptOutline } from "../../platform/transcript/outline";
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
  onEdit?(messageId: string, content: string): Promise<void>;
  onFork?: { label: string; run(anchor: { id: string; seq: number }): void };
}) {
  const copy = useMemo(() => chatCopy(locale), [locale]),
    chatId = head.chat.id;
  const editTranslation = useComposerTranslation(locale);
  const [editing, setEditing] = useState<string | null>(null);
  // Titles, presence and queue publication do not invalidate immutable transcript pages.
  const search = useMemo(() => createTranscriptFind(head, source), [head.chat.id, head.chat.incarnationId, head.bodyRevision, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const outline = useMemo(() => createTranscriptOutline(head, source), [head.chat.id, head.chat.incarnationId, head.bodyRevision, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const [outlineState, setOutline] = useState<{ reader: typeof outline; items: CanonicalOutlineItem[] } | null>(null);
  useEffect(() => {
    if (!outlineEnabled) return;
    const abort = new AbortController();
    void outline.read(abort.signal).then(items => { if (!abort.signal.aborted) setOutline({ reader: outline, items }); }).catch(() => {});
    return () => abort.abort();
  }, [outline, outlineEnabled]);
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
  const model = useConversationModelPublisher();
  const publishedWindow = useMemo(() => ({
    bodies: value.items.flatMap(item => item.kind === "native" ? [item.body] : []),
    segments: value.items.map(item => ({ kind: item.kind, id: item.kind === "native" ? item.body.message.id : item.entry.entryVersionId })),
  }), [value.items]);
  useEffect(() => {
    model?.publish({ chatId, incarnationId: head.chat.incarnationId, ...publishedWindow,
      live: currentLive?.draft ?? null, ready: !value.busy && value.state === "ready", hasEarlier: value.canEarlier,
      latest: value.latest, canonicalReady });
  }, [model, chatId, head.chat.incarnationId, publishedWindow, value.busy, value.state, value.canEarlier, value.latest, currentLive, canonicalReady]);
  const lastUser = value.items.filter(item => item.kind === "native" && item.body.message.role === "user").at(-1);
  const latestMessage = value.items.filter(item => item.kind === "native").at(-1);
  const finalPlan = latestMessage?.kind === "native" && latestMessage.body.message.role === "assistant" &&
    latestMessage.body.message.kind === "plan" && !latestMessage.body.message.isError && latestMessage.body.message.completion !== "interrupted" && !head.openTurnId ? latestMessage.body.message.id : null;
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
  const messages = useMemo(() => timelineRows(value.items), [value.items]);
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
        navigation={jumpTo => <>{findEnabled && <TranscriptFind chatId={chatId} find={search.find} t={findT} jumpTo={jumpTo} surfaceVisible />}{outlineEnabled && <ChatOutline canonicalItems={outlineState?.reader === outline ? outlineState.items : undefined} messages={value.items.flatMap(item => item.kind === "native" ? [item.body.message] : [])} label={copy.outline} onJump={jumpTo} />}</>}
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
          {value.busy && !value.items.length && <ConversationSkeleton label={copy.loading} />}
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
            !value.items.length && (
              <p className="chat-content-status">{copy.empty}</p>
            )}
        </>}
        row={({ item }) => <>
                  {item.kind === "native" ? (editing === item.body.message.id && onEdit ?
                    <UserMessageEditor key={editing} t={editTranslation} content={item.body.message.content} onCancel={() => setEditing(null)} onSubmit={content => onEdit(item.body.message.id, content)} /> : <TranscriptMessage
                      chatId={chatId}
                      onOpenImage={onOpenImage}
                      body={item.body}
                      edit={onEdit && item === lastUser && latestMessage?.kind === "native" && latestMessage.body.message.seq === head.headSeq && !head.openTurnId && item.body.message.segment !== "imported"
                        ? { label: editTranslation("chatRevision.edit"), onClick: () => setEditing(item.body.message.id) } : undefined}
                      fork={onFork && item.body.message.role === "assistant" && item.body.message.completion !== "interrupted"
                        ? { label: onFork.label, onClick: () => onFork.run(item.body.message) } : undefined}
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

          {remote?.entries
            .filter(
              (entry) =>
                entry.optimistic &&
                !canonicalCommands.includes(entry.input.commandId) &&
                entry.input.payload.kind === "start-turn",
            )
            .map((entry) => (
              <article
                key={entry.input.commandId}
                className="chat-message chat-remote-optimistic pb-6"
                data-command-id={entry.input.commandId}
              >
                <Message from="user">
                  <MessageContent className="gap-1">
                    <ConversationFold
                      measurementKey={entry.input.payload}
                      showMore={copy.showMore}
                      showLess={copy.showLess}
                    >
                      <MessageResponse>
                        {entry.input.payload.kind === "start-turn"
                          ? entry.input.payload.text
                          : ""}
                      </MessageResponse>
                    </ConversationFold>
                  </MessageContent>
                  <p className="text-xs text-muted-foreground" role="status">
                    {entry.receipt
                      ? remote.copy[entry.receipt.state]
                      : remote.copy.receiptUnknown}
                  </p>
                </Message>
              </article>
            ))}
          <LiveReply
            value={draft}
            copy={copy}
            canonicalReady={canonicalReady}
            remote={remote}
          />
          {currentLive?.error && (
            <p className="chat-content-status" role="status">
              {copy.unknown}
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
