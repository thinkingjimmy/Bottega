/**
 * [INPUT]: Depends on the live settlement/projection model, shared native message surfaces and Markdown and optional exact remote interaction controls.
 * [OUTPUT]: Shows verified live output through the canonical groupParts/ToolGroup presentation, unknown/sealing states and original-request controls gated by complete replay.
 * [POS]: The conversation body's live reply beside message.tsx; only a matching durable body or explicit empty receipt removes it.
 */
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import { groupParts } from "@ai-chat/ui/components/conversation/activity/groups";
import { ToolGroup, ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";
import type { LiveProjection } from "@ai-chat/cloud-protocol/turns/live";
import type { ChatLiveView } from "../../../platform/model";
import type { ChatCopy } from "../../../i18n/copy";
import {
  RemoteInteractions,
  type RemoteInteractionControls,
} from "../../remote/turn/interactions";
export function LiveReply({
  value,
  copy,
  canonicalReady,
  remote,
}: {
  value: ChatLiveView;
  copy: ChatCopy;
  canonicalReady: boolean;
  remote?: RemoteInteractionControls;
}) {
  const state = value.state,
    projection = value.projection;
  if (
    !state ||
    (state.receipt.settlementState === "settled" &&
      (state.receipt.resultKind === "empty" || canonicalReady))
  )
    return null;
  const status =
    state.receipt.settlementState === "sealing"
      ? copy.sealing
      : state.receipt.settlementState === "settled"
        ? copy.settling
        : state.state === "unknown"
          ? copy.unknown
          : copy.running;
  // Turn admission persists the original coordinator requestId as turnId.
  const requestId = state.receipt.turnId;
  return (
    <section className="chat-live" aria-label={status}>
      <Message from="assistant">
        <MessageContent>
          <p className="chat-live-status" role="status">
            {status}
          </p>
          {!value.replayComplete && <p role="status">{copy.settling}</p>}
          {projection && <LiveParts parts={projection.draft.parts} copy={copy} />}
          {projection?.draft.streaming.map(([id, text]) => (
            <MessageResponse key={id} isAnimating>
              {text}
            </MessageResponse>
          ))}
          {projection?.subagents.map((agent) => (
            <details className="chat-disclosure" key={agent.meta.agentThreadId}>
              <summary>{agent.meta.name || copy.subagent}</summary>
              {agent.draft ? (
                <>
                  <LiveParts parts={agent.draft.parts} copy={copy} />
                  {agent.draft.streaming.map(([id, text]) => (
                    <MessageResponse key={id} isAnimating>
                      {text}
                    </MessageResponse>
                  ))}
                </>
              ) : (
                <p>{copy.unavailableDetail}</p>
              )}
            </details>
          ))}
          {remote ? (
            <RemoteInteractions
              key={requestId}
              projection={projection}
              requestId={requestId}
              controls={remote}
              running={
                state.state === "running" &&
                state.receipt.settlementState === "open"
              }
              ready={value.replayComplete}
            />
          ) : (
            Boolean(
              projection?.approvals.length || projection?.userInputs.length,
            ) && (
              <aside className="chat-readonly-interactions">
                <p>{copy.interactions}</p>
                {projection?.approvals.map((item) => (
                  <p key={item.approvalId}>
                    {item.reason || item.command || item.purpose}
                  </p>
                ))}
                {projection?.userInputs.flatMap((item) =>
                  item.questions.map((question) => (
                    <p key={`${item.userInputId}:${question.id}`}>
                      {question.question}
                    </p>
                  )),
                )}
              </aside>
            )
          )}
        </MessageContent>
      </Message>
    </section>
  );
}

function LiveParts({ parts, copy }: { parts: LiveProjection["draft"]["parts"]; copy: ChatCopy }) {
  return groupParts(parts).map(group => {
    if (group.type === "tools") return group.parts.length === 1 && group.parts[0]!.tool === "reasoning"
      ? <ToolRow key={group.key} part={group.parts[0]!} /> : <ToolGroup key={group.key} parts={group.parts} />;
    const part = group.part;
    if (part.type === "text") return <MessageResponse key={part.itemId}>{part.text}</MessageResponse>;
    if (part.type === "tool") return <ToolRow key={part.itemId} part={part} />;
    return <p key={part.itemId}>{part.name || copy.subagent}</p>;
  });
}
