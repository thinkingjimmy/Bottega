/**
 * [INPUT]: The reader's state and native Conversation geometry.
 * [OUTPUT]: Provides TimelineView — one transcript layout with row/live ordering, navigation slots and a gap slot before a named row — and TimelineNotice, the divider-styled note with one action (a gap, the way back to the newest messages).
 * [POS]: The timeline's only rendered surface; every rule it shows comes from reader.ts.
 */
import { Fragment, useState, type ReactNode } from "react";
import { ChevronUp, Loader2 } from "lucide-react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@ai-chat/ui/components/ai-elements/conversation";
import { conversationColumnClassName } from "@ai-chat/ui/components/conversation/layout";
import { TranscriptDividerRow as ConversationDivider } from "@ai-chat/ui/components/conversation/layout";
import { useTimelineReader, type TimelineReader } from "./reader";
import type { TranscriptRow } from "./window";
export type TimelineViewProps<Row extends TranscriptRow> = TimelineReader<Row> & {
  row(message: Row): ReactNode;
  live?: { seq?: number; content: ReactNode };
  /** Rows the host could not show between two it does show: the mark renders right before the row `before`. */
  gap?: { before: string; content: ReactNode };
  navigation?(jump: (id: string) => boolean, messages: readonly Row[]): ReactNode;
  before?: ReactNode; after?: ReactNode; overlay?: ReactNode;
  busy?: boolean;
  context?(children: ReactNode): ReactNode;
  copy: { earlier: string; loading: string; imported: string; loaded(count: number): string };
};
export function TimelineView<Row extends TranscriptRow>(props: TimelineViewProps<Row>) {
  const [historyBatch, setHistoryBatch] = useState(false);
  const content = <TimelineContent {...props} setHistoryBatch={setHistoryBatch} />;
  return <Conversation data-timeline="" aria-busy={props.busy} aria-live={historyBatch ? "off" : undefined} className="min-h-0 min-w-0 flex-1" initial="instant" resize="instant" role={historyBatch ? undefined : "log"}>
    {props.context ? props.context(content) : content}
  </Conversation>;
}
function TimelineContent<Row extends TranscriptRow>(props: TimelineViewProps<Row> & { setHistoryBatch(active: boolean): void }) {
  const reader = useTimelineReader(props), { copy, live } = props;
  const liveIndex = live?.seq === undefined ? -1 : reader.messages.findIndex(message => message.segment !== "imported" && message.seq > live.seq!);
  const renderRows = (messages: readonly Row[]) => {
    const boundary = messages.findIndex(message => message.segment !== "imported");
    const imported = boundary < 0 ? messages : messages.slice(0, boundary), native = boundary < 0 ? [] : messages.slice(boundary);
    const render = (message: Row) => <Fragment key={message.id}>{props.gap?.before === message.id && props.gap.content}{props.row(message)}</Fragment>;
    return <>{imported.length > 0 && <section aria-label={copy.imported} className="contents">{imported.map(render)}</section>}{native.map(render)}</>;
  };
  return <>
    <ConversationContent className={`${conversationColumnClassName} gap-6`} data-transcript-content="" tabIndex={-1}>
      {props.before}
      {reader.hasEarlier && <ConversationDivider><button className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60" data-load-earlier="" disabled={reader.loadingEarlier} onClick={reader.loadEarlier} type="button">
        {reader.loadingEarlier ? <><Loader2 className="size-3 animate-spin motion-reduce:animate-none" />{copy.loading}</> : <><ChevronUp className="size-3" />{copy.earlier}</>}
      </button></ConversationDivider>}
      {renderRows(liveIndex < 0 ? reader.messages : reader.messages.slice(0, liveIndex))}
      {live?.content}
      {liveIndex >= 0 && renderRows(reader.messages.slice(liveIndex))}
      {props.after}
    </ConversationContent>
    <div aria-live="polite" className="sr-only" role="status">{reader.announcement && <span key={reader.announcement.generation}>{copy.loaded(reader.announcement.count)}</span>}</div>
    {props.navigation?.(reader.jumpTo, reader.messages)}{props.overlay}<ConversationScrollButton />
  </>;
}

/** A divider-styled note with one action, for what the window does not show: a gap between rows, or the newest messages. */
export function TimelineNotice({ label, action, onAction, busy, ...data }: { label?: string; action: string; onAction(): void; busy?: boolean } & Record<`data-${string}`, string>) {
  return <ConversationDivider><span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status" {...data}>
    {label}
    <button className="inline-flex h-7 items-center rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60" disabled={busy} onClick={onAction} type="button">{action}</button>
  </span></ConversationDivider>;
}
