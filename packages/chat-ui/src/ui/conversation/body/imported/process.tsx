/**
 * [INPUT]: Depends on verified individual or packed imported JSON fields, the native history projection and shared activity rows.
 * [OUTPUT]: Renders source-ordered assistant prose and tools inside the common completed-work disclosure, noting tool outputs the importer folded away.
 * [POS]: The imported subtree's lazy activity adapter under conversation/body; oversized or unsupported fields remain available through full downloads.
 */
import { useEffect, useState } from "react";
import { decodeImportedActivityField, projectForeignParts } from "@ai-chat/cloud-protocol/chats/imported/projection";
import { MESSAGE_BYTE_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import type { ChatPart } from "@ai-chat/cloud-protocol/chats/content/parts";
import { MessageContent, MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { groupParts } from "@ai-chat/ui/components/conversation/activity/groups";
import { ToolGroup, ToolRow } from "@ai-chat/ui/components/conversation/activity/tools";
import { Button } from "@ai-chat/ui/components/ui/button";
import { AUTOMATIC_FIELD_BYTES, useImportedField } from "./use-field";
import { Download, ReadStatus, type FieldProps } from "./controls";

// Large originals remain downloadable without parsing unbounded JSON in the renderer.
const JSON_PRESENTATION_BYTES = 2 * 1024 * 1024;
function ActivityField({ chatId, field, source, copy }: FieldProps) {
  const reader = useImportedField(chatId, field, source, field.bytes <= AUTOMATIC_FIELD_BYTES);
  const blob = reader.value.blob;
  const [decoded, setDecoded] = useState<{ blob: Blob; parts: ChatPart[] | null } | null>(null);
  useEffect(() => {
    if (!blob) return;
    let current = true;
    void (async () => {
      let parts: ChatPart[] | null = null;
      try {
        if (blob.size <= JSON_PRESENTATION_BYTES && field.encoding === "json") {
          const value: unknown = JSON.parse(await blob.text());
          const input = decodeImportedActivityField(field.field, value);
          if (input) parts = projectForeignParts({ ...input, budgetBytes: MESSAGE_BYTE_LIMIT, itemIdPrefix: field.field });
        }
      } catch { /* A verified but unsupported field remains independently downloadable. */ }
      if (current) setDecoded({ blob, parts });
    })();
    return () => { current = false; };
  }, [blob, field]);
  const parts = decoded?.blob === blob ? decoded?.parts : undefined;
  return <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2">
    <ReadStatus reader={reader} copy={copy} />
    {!blob && !reader.value.busy && !reader.value.error && <Button variant="ghost" size="sm" onClick={() => void reader.load()}>{copy.showMore}</Button>}
    {parts && groupParts(parts).map(group => group.type === "text" ? <MessageContent className="w-full" key={group.part.itemId}><MessageResponse>{group.part.text}</MessageResponse></MessageContent>
      : group.type === "tools" ? <ToolGroup key={group.key} parts={group.parts} />
      : group.type === "image" || group.type === "failure" ? <ToolRow key={group.part.itemId} part={group.part} /> : null)}
    {parts === null && <p className="text-sm text-muted-foreground">{copy.unavailableDetail}</p>}
    {blob && (blob.size > MESSAGE_BYTE_LIMIT || parts === null) && <Download reader={reader} field={field} copy={copy} />}
  </div>;
}
export function ImportedActivity({ fields, omittedTools = 0, ...props }: Omit<FieldProps, "field"> & { fields: FieldProps["field"][]; omittedTools?: number }) {
  // Process steps precede the final answer's tools; numeric suffixes are source order, not lexical order.
  const ordered = [...fields].sort((a, b) => {
    const rank = (field: string) => field === "process" || field.startsWith("process-") ? 0 : 1;
    return rank(a.field) - rank(b.field) || a.field.localeCompare(b.field, "en", { numeric: true });
  });
  return <div className="flex w-full min-w-0 flex-col gap-2">
    {ordered.map(field => <ActivityField key={field.field} {...props} field={field} />)}
    {omittedTools > 0 && <p className="text-xs text-muted-foreground">{props.copy.omittedTools.replace("{count}", String(omittedTools))}</p>}
  </div>;
}
