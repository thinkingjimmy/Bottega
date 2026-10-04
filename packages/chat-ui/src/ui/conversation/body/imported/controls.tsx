/**
 * [INPUT]: Depends on the scoped imported field reader and caller-owned copy.
 * [OUTPUT]: Provides verification feedback, text window navigation and full-field downloads.
 * [POS]: The imported subtree's controls under conversation/body; file lifetimes remain in use-field.ts.
 */
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { TranscriptSource } from "../../../../platform/contracts";
import type { ChatCopy } from "../../../../i18n/copy";
import { ConversationDownload } from "@ai-chat/ui/components/conversation/actions";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { useImportedField } from "./use-field";
type Reader = ReturnType<typeof useImportedField>;
export type FieldProps = {
  chatId: string;
  field: ImportedEntry["fields"][number];
  source: Pick<TranscriptSource, "file">;
  copy: ChatCopy;
};
export function ReadStatus({ reader, copy }: { reader: Reader; copy: ChatCopy }) {
  return (
    <>
      {reader.value.busy && (
        <p className="text-xs text-muted-foreground" role="status">
          {copy.loading}
        </p>
      )}
      {reader.value.error && (
        <p className="text-xs text-muted-foreground" role="alert">
          {copy.failedFile}{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void reader.load()}
          >
            {copy.retry}
          </Button>
        </p>
      )}
    </>
  );
}
export function Pages({ reader, copy }: { reader: Reader; copy: ChatCopy }) {
  const { value, move } = reader;
  if (value.previous.length <= 1 && value.next == null) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {value.previous.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void move(value.previous.at(-2)!, value.previous.slice(0, -1))
          }
        >
          {copy.previous}
        </Button>
      )}
      {value.next != null && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            void move(value.next!, [...value.previous, value.next!])
          }
        >
          {copy.next}
        </Button>
      )}
    </div>
  );
}
export function Download({
  reader,
  field,
  copy,
}: {
  reader: Reader;
  field: FieldProps["field"];
  copy: ChatCopy;
}) {
  if (!reader.value.url) return null;
  return (
    <ConversationDownload
      href={reader.value.url}
      filename={`${field.field}.${field.encoding === "json" ? "json" : "txt"}`}
      label={copy.download}
    />
  );
}
