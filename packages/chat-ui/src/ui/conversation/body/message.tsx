/**
 * [INPUT]: Depends on portable messages, shared native Agent, duration, tool-group, message, fold, process and action components, the shared artifact renderer boundary, injected private files, Agent names and localized origin copy.
 * [OUTPUT]: Renders canonical messages (Edit/Fork as stable callbacks bound per row, D-02) with concise Agent boundaries, remote source labels, Plan, tool, image and recursive read-only Subagent content; copies terminal bodies with interruption annotations.; with `remoteFailure` (a host showing a Chat another computer runs) a failed turn's capsule is said as a ProductFailureNotice naming that computer and the message's own Agent, never its safe details; with the same host, a notice with a line of its own (U06-d's declined extension) reads from its kind in the viewer's language, never its stored line
 * [POS]: The conversation body's root message surface for desktop and Web; no execution command or local authority is reconstructed.
 */
import { projectUnavailableArtifacts } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ArtifactMessageRenderers } from "../../../artifacts/renderer";
import { memo, useMemo } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ChatPart } from "@ai-chat/cloud-protocol/chats/content/parts";
import type { TranscriptSource } from "../../../platform/contracts";
import type { ChatCopy } from "../../../i18n/copy";
import { TranscriptFile } from "./file";
import { backendName, remoteCopy } from "../../../i18n/messages/remote";
import { remoteFailureCopy } from "../../../i18n/messages/failure";
import { remoteNoticeText } from "../../../i18n/messages/notice";
import { ProductFailureNotice } from "@ai-chat/ui/components/feedback/failure-notice";
import { ConversationActions } from "@ai-chat/ui/components/conversation/actions";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
import { ConversationAgent, ConversationProcess, ConversationProcessHeading } from "@ai-chat/ui/components/conversation/process";
import { conversationWorkedFor } from "@ai-chat/ui/components/conversation/activity/format";
import { groupParts } from "@ai-chat/ui/components/conversation/activity/groups";
import { ToolGroup, ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";
import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { ImageIdentity } from "../../side-panel/image/identity";
type Props = {
  chatId: string;
  body: ChatBody;
  source: Pick<TranscriptSource, "file">;
  copy: ChatCopy;
  locale: string;
  onOpenImage?(identity: ImageIdentity): void;
  onOpenSubagent?(id: string): void;
  /** Stable across renders (D-02): the row binds its own message, so a streaming tick never re-renders history. */
  onEdit?(messageId: string): void; editLabel?: string;
  onFork?(message: ChatBody["message"]): void; forkLabel?: string;
  /** Set by a host that shows a Chat another computer runs (the remote conversation): a failed turn's capsule is said here, naming that
   *  computer. A host that renders the capsule itself (the desktop's own Chats) leaves it unset, so a failure is never shown twice. */
  remoteFailure?: { computer: string };
};
export function TranscriptParts({
  parts,
  parents = [],
  ...props
}: Props & { parts: ChatPart[]; parents?: string[] }) {
  return (
    <>
      {groupParts(parts).map((group) => {
        if (group.type === "tools") return group.parts.length === 1 && group.parts[0]!.tool === "reasoning"
          ? <ToolRow key={group.key} part={group.parts[0]!} /> : <ToolGroup key={group.key} parts={group.parts} />;
        const part = group.part;
        if (part.type === "text")
          return (
            <MessageResponse key={part.itemId}>
              {projectUnavailableArtifacts(part.text)}
            </MessageResponse>
          );
        if (part.type === "subagent") {
          const agent = props.body.subagents?.[part.agentThreadId],
            repeated = parents.includes(part.agentThreadId);
          if (props.onOpenSubagent) return <button key={part.itemId} type="button" className="min-h-11 text-sm" onClick={() => props.onOpenSubagent!(part.agentThreadId)}>{part.name || props.copy.subagent}</button>;
          return (
            <details className="w-full min-w-0 text-sm text-muted-foreground" key={part.itemId}>
              <summary>{part.name || props.copy.subagent}</summary>
              {agent && !repeated ? (
                <TranscriptParts
                  {...props}
                  parts={agent.parts}
                  parents={[...parents, part.agentThreadId]}
                />
              ) : (
                <p>{props.copy.unavailableDetail}</p>
              )}
              {part.completion === "interrupted" && (
                <p role="note">{props.copy.interrupted}</p>
              )}
            </details>
          );
        }
        const media = props.body.media.find(
          (file) =>
            file.itemId === part.itemId &&
            file.subagentId === (parents.at(-1) ?? null),
        );
        return <div key={part.itemId} className="w-full min-w-0">
          <ToolRow part={part} />
          {media && <TranscriptFile chatId={props.chatId} descriptor={media.blob} name={part.title || media.itemId} source={props.source} copy={props.copy} onOpenImage={props.onOpenImage && props.body.message.segment !== "imported" ? () => props.onOpenImage!({ kind: "generated", messageId: props.body.message.id, subagentId: media.subagentId, itemId: media.itemId }) : undefined} />}
          {part.completion === "interrupted" && <p role="note">{props.copy.interrupted}</p>}
        </div>;
      })}
    </>
  );
}
export const TranscriptMessage = memo(function TranscriptMessage(props: Props) {
  const { chatId, body, source, copy, locale, onEdit, editLabel, onFork, forkLabel } = props,
    message = body.message;
  const edit = useMemo(() => onEdit && editLabel ? { label: editLabel, onClick: () => onEdit(message.id) } : undefined, [onEdit, editLabel, message.id]);
  const fork = useMemo(() => onFork && forkLabel ? { label: forkLabel, onClick: () => onFork(message) } : undefined, [onFork, forkLabel, message]);
  if (message.role === "notice") {
    const notice = message.notice;
    if (notice.kind === "app-chat-ready") return null;
    // A remote viewer reads a notice with a line of its own from its kind, in its language (U06-d); the stored line is the rest's fallback.
    const remote = props.remoteFailure ? remoteNoticeText(notice, locale, props.remoteFailure) : null;
    const text =
      notice.kind === "agent-switched"
          ? copy.switchedAgent.replace("{agent}", backendName(notice.to))
          : remote ?? message.content;
    return (
      <div data-message-id={message.id}>
        <div className="chat-notice" role="separator">
          <span>{text}</span>
        </div>
      </div>
    );
  }
  const text = message.role === "assistant" && message.completion === "interrupted"
    ? `${message.content}\n\n[${copy.interrupted}]` : message.content;
  const workedFor = message.role === "assistant" ? conversationWorkedFor({ durationMs: message.durationMs, isError: message.isError, hasParts: Boolean(message.parts?.length), imported: message.segment === "imported" }, locale) : null;
  return (
    <ArtifactMessageRenderers>
      <article
        className="chat-message"
        data-message-id={message.id}
        tabIndex={-1}
      >
        {message.role === "assistant" && <ConversationAgent icon={<AgentBackendIcon backend={message.backend} className="size-3" />} label={backendLabel(message.backend)} />}
        <Message from={message.role}>
          {body.attachments.map((file) => (
            <TranscriptFile
              key={file.attachmentId}
              chatId={chatId}
              descriptor={file.blob}
              name={
                message.role === "user"
                  ? (message.attachments?.find(
                      (item) => item.id === file.attachmentId,
                    )?.filename ?? copy.attachment)
                  : copy.attachment
              }
              onOpenImage={props.onOpenImage && message.segment !== "imported" ? () => props.onOpenImage!({ kind: "attachment", attachmentId: file.attachmentId }) : undefined}
              source={source}
              copy={copy}
            />
          ))}
          {message.role === "assistant" && message.parts?.length ? (
            <ConversationProcess label={workedFor ?? copy.process}>
              <TranscriptParts {...props} parts={message.parts} />
            </ConversationProcess>
          ) : workedFor ? <ConversationProcessHeading label={workedFor} /> : null}
          {message.role === "assistant" && message.kind === "plan" && (
            <span className="chat-plan-label">{copy.plan}</span>
          )}
          {message.content && (
            <MessageContent className="gap-1">
              {message.role === "user" ? (
                <ConversationFold
                  measurementKey={message.content}
                  showMore={copy.showMore}
                  showLess={copy.showLess}
                >
                  <MessageResponse>
                    {projectUnavailableArtifacts(message.content)}
                  </MessageResponse>
                </ConversationFold>
              ) : (
                <MessageResponse>
                  {projectUnavailableArtifacts(message.content)}
                </MessageResponse>
              )}
            </MessageContent>
          )}
          {message.role === "user" && message.remoteSource && (
            <span className="text-xs text-muted-foreground">
              {remoteCopy(locale).from.replace(
                "{device}",
                message.remoteSource.name,
              )}
            </span>
          )}
          {message.role === "assistant" && message.failure && props.remoteFailure && (
            <ProductFailureNotice compact copy={remoteFailureCopy(message.failure, locale, { backend: backendName(message.backend), computer: props.remoteFailure.computer })} />
          )}
          {message.role === "assistant" &&
            message.completion === "interrupted" && (
              <p className="text-sm text-muted-foreground" role="status">
                {copy.interrupted}
              </p>
            )}
          <ConversationActions
            role={message.role}
            fork={fork}
            edit={edit}
            onCopy={() => navigator.clipboard.writeText(text)}
            copyLabel={copy.copy}
            copiedLabel={copy.copied}
            timestamp={
              <time dateTime={new Date(message.createdAt).toISOString()}>
                {new Intl.DateTimeFormat(locale, {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(message.createdAt)}
              </time>
            }
          />
        </Message>
      </article>
    </ArtifactMessageRenderers>
  );
});
