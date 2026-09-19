/**
 * [INPUT]: Depends on immutable imported fields, scoped verification, shared native message surfaces, the shared artifact renderer boundary and localized controls.
 * [OUTPUT]: Renders imported messages once in the native conversation layout, with immediate prepared bodies or bounded reads, native Agent/duration headings, lazy activity including folded-tool notes and explicit complete-body copy.
 * [POS]: The imported leaf beside the conversation body's native message.tsx; previews remain explicit until verified content replaces them.
 */
import { projectUnavailableArtifacts } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@ai-chat/ui/components/ai-elements/message";
import {
  ConversationActions,
} from "@ai-chat/ui/components/conversation/actions";
import { ConversationFold } from "@ai-chat/ui/components/conversation/fold";
import { ConversationAgent, ConversationProcess, ConversationProcessHeading } from "@ai-chat/ui/components/conversation/process";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ArtifactMessageRenderers } from "../../../../artifacts/renderer";
import type { TranscriptSource } from "../../../../platform/contracts";
import type { ChatCopy } from "../../../../i18n/copy";
import { AUTOMATIC_FIELD_BYTES, useImportedField } from "./use-field";

import { ReadStatus, Pages } from "./controls";
import { ImportedActivity } from "./process";
import { conversationWorkedFor } from "@ai-chat/ui/components/conversation/activity/format";
import { AgentBackendIcon, backendLabel, type AgentBackendId } from "@ai-chat/ui/components/identity/agent";
import type { PreparedImportedField } from "../../../../platform/transcript/fields";
export function ImportedMessage({
  chatId,
  entry,
  backend,
  content: prepared,
  source,
  copy,
  locale = "en",
}: {
  chatId: string;
  entry: ImportedEntry;
  backend?: AgentBackendId;
  content?: PreparedImportedField;
  source: Pick<TranscriptSource, "file">;
  copy: ChatCopy;
  locale?: string;
}) {
  const field = entry.fields.find((item) => item.field === "content")!;
  const reader = useImportedField(
    chatId,
    field,
    source,
    field.bytes <= AUTOMATIC_FIELD_BYTES,
    prepared,
  );
  const { value } = reader;
  const process = entry.fields.filter((item) => item.field !== "content");
  const omittedTools = entry.omitted?.tools ?? 0;
  const workedFor = entry.role === "assistant" ? conversationWorkedFor({ durationMs: entry.workedForMs, hasParts: process.length > 0, imported: true }, locale) : null;
  const content = value.text ?? entry.preview;
  const body = (
    <MessageResponse
      key={value.text === undefined ? "preview" : value.previous.at(-1)}
    >
      {projectUnavailableArtifacts(content)}
    </MessageResponse>
  );
  return (
    <ArtifactMessageRenderers>
      <article
        className="chat-message"
        data-message-id={entry.entryVersionId}
        aria-label={copy.imported}
        tabIndex={-1}
      >
        {entry.role === "assistant" && <ConversationAgent icon={backend ? <AgentBackendIcon backend={backend} className="size-3" /> : null} label={backend ? backendLabel(backend) : copy.assistant} />}
        <Message key={`${chatId}:${entry.entryVersionId}`} from={entry.role}>
          {process.length > 0 || omittedTools > 0 ? (
            <ConversationProcess label={workedFor ?? copy.process}>
              <ImportedActivity chatId={chatId} fields={process} omittedTools={omittedTools} source={source} copy={copy} />
            </ConversationProcess>
          ) : workedFor ? <ConversationProcessHeading label={workedFor} /> : null}
          <MessageContent className="gap-1" aria-busy={value.busy || undefined}>
            {entry.role === "user" ? (
              <ConversationFold
                measurementKey={content}
                showMore={copy.showMore}
                showLess={copy.showLess}
              >
                {body}
              </ConversationFold>
            ) : (
              body
            )}
            <ReadStatus reader={reader} copy={copy} />
            {value.text === undefined && !value.busy && !value.error && (
              <Button
                type="button"
                className="self-start"
                variant="ghost"
                size="sm"
                onClick={() => void reader.load()}
              >
                {copy.fullMessage}
              </Button>
            )}
            <Pages reader={reader} copy={copy} />
          </MessageContent>
          {entry.completion === "interrupted" && (
            <p role="status" className="text-sm text-muted-foreground">
              {copy.interrupted}
            </p>
          )}
          <ConversationActions
            role={entry.role}
            onCopy={async () => {
              const text = await reader.readText();
              await navigator.clipboard.writeText(entry.role === "assistant" && entry.completion === "interrupted"
                ? `${text}\n\n[${copy.interrupted}]` : text);
            }}
            copyLabel={copy.copy}
            copiedLabel={copy.copied}
            timestamp={
              entry.createdAt !== null ? (
                <time dateTime={new Date(entry.createdAt).toISOString()}>
                  {new Intl.DateTimeFormat(locale, {
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(entry.createdAt)}
                </time>
              ) : undefined
            }
          />
        </Message>
      </article>
    </ArtifactMessageRenderers>
  );
}
