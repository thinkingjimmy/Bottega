/**
 * [INPUT]: Depends on React layout effects/refs, AI Elements Message/UI Button/Textarea, i18n, and renderer error normalization
 * [OUTPUT]: Provides a full-row UserMessageEditor focused at the text end, with a distinct cancel hover surface and stable submit, busy, and error behavior
 * [POS]: The chat/transcript revision editor; main confirms canonical replacement before the editor exits
 */

import { useLayoutEffect, useRef, useState } from "react";
import {
  Message,
  MessageContent,
} from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage, failureCode } from "@/lib/errors";
import {
  REVISION_NOT_IDLE,
  REVISION_STALE,
} from "../../../../shared/chats-ipc";

export function UserMessageEditor({
  content,
  onCancel,
  onSubmit,
}: {
  content: string;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<void>;
}) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState(content);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const end = textarea.value.length;
    textarea.focus();
    textarea.setSelectionRange(end, end);
  }, []);

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onSubmit(draft);
      onCancel();
    } catch (cause) {
      /* 稳定码不穿 UI：两枚修订专属码折成五语言人话，其余原样。
         分类读 failureCode，而不是拿剥净后的人话去比码——`CODE` 与
         `CODE: 人话` 两种写法都要落进同一个分支，剥净的那一半永远比不中。 */
      const code = failureCode(cause);
      setError(
        code === REVISION_NOT_IDLE
          ? t("chatRevision.notIdle")
          : code === REVISION_STALE
            ? t("chatRevision.stale")
            : errorMessage(cause)
      );
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Message className="max-w-none" from="user">
      <MessageContent className="w-full gap-3 group-[.is-user]:w-full">
        <Textarea
          aria-label={t("chatRevision.editing")}
          className="max-h-64 min-h-28 resize-y overflow-auto font-mono"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || busy) return;
            event.preventDefault();
            onCancel();
          }}
          ref={textareaRef}
          value={draft}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button
            className="hover:bg-background dark:hover:bg-background"
            disabled={busy}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("chatRevision.cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void submit()} size="sm" type="button">
            {t("chatRevision.send")}
          </Button>
        </div>
      </MessageContent>
    </Message>
  );
}
