/**
 * [INPUT]: Depends on React, AI Elements Message/UI Button/Textarea, i18n and renderer error are combined
 * [OUTPUT]: Provides UserMessageEditor; The following is a list of the most commonly used methods for the analysis of the data:
 * [POS]: The edit of the revised chat/transcript sheet; The canonical replacement was successfully overturned by the main event
 */

import { useRef, useState } from "react";
import {
  Message,
  MessageContent,
} from "@ai-chat/ui/components/ai-elements/message";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Textarea } from "@ai-chat/ui/components/ui/textarea";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { errorMessage } from "@/lib/errors";
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

  const submit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      await onSubmit(draft);
      onCancel();
    } catch (cause) {
      /* 稳定码不穿 UI：两枚修订专属码折成五语言人话，其余原样。 */
      const raw = errorMessage(cause);
      setError(
        raw === REVISION_NOT_IDLE
          ? t("chatRevision.notIdle")
          : raw === REVISION_STALE
            ? t("chatRevision.stale")
            : raw
      );
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Message from="user">
      <MessageContent className="w-full gap-3">
        <Textarea
          aria-label={t("chatRevision.editing")}
          autoFocus
          className="max-h-64 min-h-28 resize-y overflow-auto font-mono"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || busy) return;
            event.preventDefault();
            onCancel();
          }}
          value={draft}
        />
        {error && <p className="text-destructive text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={onCancel} size="sm" type="button" variant="ghost">
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
