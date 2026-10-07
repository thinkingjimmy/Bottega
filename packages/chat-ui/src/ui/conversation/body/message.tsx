/**
 * [INPUT]: Canonical built-in Provider ids; Portable messages, shared turn and action views, artifact renderers, private file access and host-owned detail callbacks.
 * [OUTPUT]: Renders origin-free canonical user bubbles, Agent/process headings, Plan, tools, media and subagents with Edit/Fork/copy actions and localized failure or interruption presentation.
 * [POS]: Canonical transcript adapter for Web and desktop mirrors; no execution command or local authority is reconstructed.
 */
import { BUILTIN_PROVIDER_IDS } from "@ai-chat/cloud-protocol/chats/backend-id";
import { projectUnavailableArtifacts } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ArtifactMessageRenderers } from "../../../artifacts/renderer";
import { lazy, memo, Suspense, useMemo, useState, type ComponentProps } from "react";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import type { ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { DraftSubagentPart } from "@ai-chat/cloud-protocol/turns/reducer";
import type { ChatPart } from "@ai-chat/cloud-protocol/chats/content/parts";
import type { TranscriptSource } from "../../../platform/contracts";
import type { ChatCopy } from "../../../i18n/copy";
import { TranscriptFile } from "./file";
import { backendName } from "../../../i18n/messages/remote";
import { remoteFailureCopy } from "../../../i18n/messages/failure";
import { remoteNoticeText } from "../../../i18n/messages/notice";
import { ProductFailureNotice } from "@ai-chat/ui/components/feedback/failure-notice";
import { ConversationActions } from "@ai-chat/ui/components/conversation/actions";
import { ConversationUser } from "../turn/user";
import { ConversationParts } from "../turn/parts";
import { ConversationSubagent } from "../turn/subagent";
import type { ConversationPlan as PlanView } from "../turn/plan";
import { planTranslation } from "../turn/copy";
import { ConversationAgent, ConversationProcess, ConversationProcessHeading } from "@ai-chat/ui/components/conversation/process";
import { conversationWorkedFor } from "@ai-chat/ui/components/conversation/activity/format";
import { ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";
import { AgentBackendIcon, backendLabel } from "@ai-chat/ui/components/identity/agent";
import type { ImageIdentity } from "../../side-panel/image/identity";
const ConversationPlan = lazy(() => import("../turn/plan").then(module => ({ default: module.ConversationPlan })));
export function TranscriptPlan(props: ComponentProps<typeof PlanView>) {
  return <Suspense fallback={null}><ConversationPlan {...props} /></Suspense>;
}
type Props = {
  chatId: string;
  body: ChatBody;
  source: Pick<TranscriptSource, "file">;
  copy: ChatCopy;
  locale: string;
  onOpenImage?(identity: ImageIdentity): void;
  onOpenSubagent?(id: string): void;
  onOpenPlan?(id: string): void;
  expandedPlanId?: string | null;
  /** Stable across renders (D-02): the row binds its own message, so a streaming tick never re-renders history. */
  onEdit?(messageId: string): void; editLabel?: string;
  onFork?(message: ChatBody["message"]): void; forkLabel?: string;
  /** Set by a host that shows a Chat another computer runs (the remote conversation): a failed turn's capsule is said here, naming that
   *  computer. A host that renders the capsule itself (the desktop's own Chats) leaves it unset, so a failure is never shown twice. */
  remoteFailure?: { computer: string };
};
export function TranscriptParts({ parts, parents = [], ...props }: Props & { parts: ChatPart[]; parents?: string[] }) {
  return <ConversationParts parts={parts} text={projectUnavailableArtifacts}
    subagent={part => <TranscriptSubagent {...props} part={part} parents={parents} />}
    failure={part => part.failure && props.remoteFailure
      ? <ProductFailureNotice compact copy={remoteFailureCopy(part.failure, props.locale, { backend: backendName(props.body.message.role === "assistant" ? props.body.message.backend : BUILTIN_PROVIDER_IDS.codex), computer: props.remoteFailure.computer })} />
      : <ToolRow part={part} />}
    image={part => {
      const media = props.body.media.find(file => file.itemId === part.itemId && file.subagentId === (parents.at(-1) ?? null));
      return <div className="w-full min-w-0"><ToolRow part={part} />{media && <TranscriptFile chatId={props.chatId} descriptor={media.blob} name={part.title || media.itemId} source={props.source} copy={props.copy}
        onOpenImage={props.onOpenImage && props.body.message.segment !== "imported" ? () => props.onOpenImage!({ kind: "generated", messageId: props.body.message.id, subagentId: media.subagentId, itemId: media.itemId }) : undefined} />}
        {part.completion === "interrupted" && <p role="note">{props.copy.interrupted}</p>}</div>;
    }} />;
}
function TranscriptSubagent({ part, parents, ...props }: Props & { part: DraftSubagentPart; parents: string[] }) {
  const [open, setOpen] = useState(false), agent = props.body.subagents?.[part.agentThreadId], repeated = parents.includes(part.agentThreadId);
  return <div className="min-w-0"><ConversationSubagent id={part.agentThreadId} agent={agent?.meta.agent ?? part.agent}
    name={agent?.meta.name || part.name || props.copy.subagent} status={agent?.meta.status ?? part.status}
    disabled={!agent || repeated} title={!agent ? props.copy.unavailableDetail : undefined}
    onOpen={() => props.onOpenSubagent ? props.onOpenSubagent(part.agentThreadId) : setOpen(value => !value)} />
    {open && agent && !repeated && <TranscriptParts {...props} parts={agent.parts} parents={[...parents, part.agentThreadId]} />}
  </div>;
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
  const attachments = body.attachments.map(file => <TranscriptFile key={file.attachmentId} chatId={chatId} descriptor={file.blob}
    name={message.role === "user" ? message.attachments?.find(item => item.id === file.attachmentId)?.filename ?? copy.attachment : copy.attachment}
    onOpenImage={props.onOpenImage && message.segment !== "imported" ? () => props.onOpenImage!({ kind: "attachment", attachmentId: file.attachmentId }) : undefined} source={source} copy={copy} />);
  const actions = <ConversationActions role={message.role} fork={fork} edit={edit} onCopy={() => navigator.clipboard.writeText(text)} copyLabel={copy.copy} copiedLabel={copy.copied}
    timestamp={<time dateTime={new Date(message.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(message.createdAt)}</time>} />;
  return <ArtifactMessageRenderers><article className="chat-message" data-message-id={message.id} tabIndex={-1}>
    {message.role === "user" ? <ConversationUser content={projectUnavailableArtifacts(message.content)} showMore={copy.showMore} showLess={copy.showLess} attachments={attachments} actions={actions} /> : <>
      <ConversationAgent icon={<AgentBackendIcon backend={message.backend} className="size-3" />} label={backendLabel(message.backend)} />
      <Message from="assistant">{attachments}
        {message.parts?.length ? <ConversationProcess label={workedFor ?? copy.process}><TranscriptParts {...props} parts={message.parts} /></ConversationProcess>
          : workedFor ? <ConversationProcessHeading label={workedFor} /> : null}
        {message.kind === "plan" ? <TranscriptPlan content={message.content} editing={false} copyable translate={planTranslation(locale)}
          isExpanded={props.expandedPlanId === message.id} onToggle={props.onOpenPlan ? () => props.onOpenPlan!(message.id) : undefined} />
          : message.content && <MessageContent className="gap-1"><MessageResponse>{projectUnavailableArtifacts(message.content)}</MessageResponse></MessageContent>}
        {message.failure && props.remoteFailure && <ProductFailureNotice compact copy={remoteFailureCopy(message.failure, locale, { backend: backendName(message.backend), computer: props.remoteFailure.computer })} />}
        {message.completion === "interrupted" && <p className="text-sm text-muted-foreground" role="status">{copy.interrupted}</p>}
        {actions}
      </Message>
    </>}
  </article></ArtifactMessageRenderers>;
});
