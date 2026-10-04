/**
 * [INPUT]: Depends on the per-Chat composer store (unavailableAttachments, removeUnavailableAttachment), Chat i18n, and lucide icons
 * [OUTPUT]: Provides UnavailableAttachments: one removable row per draft attachment that is no longer available (a window move (F-34b), a held queued item taken back into the draft, or a restored draft (F-12))
 * [POS]: Composer draft notice beside the attachment and queue notices; the store owns the list, this only projects and removes it
 */

import { FileXIcon } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { removeUnavailableAttachment, useComposerState } from "@/lib/chat/state/composer/chat-composer-store";

export function UnavailableAttachments({ chatId }: { chatId: string }) {
  const { t } = useAppTranslation();
  const attachments = useComposerState(chatId).unavailableAttachments;
  if (!attachments.length) return null;
  return (
    <ul className="mb-2 flex flex-col gap-1 text-destructive text-xs" data-unavailable-attachments="">
      {attachments.map((attachment) => (
        <li className="flex items-start gap-2" data-unavailable-attachment={attachment.id} key={attachment.id}>
          <FileXIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <p className="min-w-0 flex-1">{t("chat.draft.fileUnavailable", { name: attachment.name })}</p>
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => removeUnavailableAttachment(chatId, attachment.id)}
            type="button"
          >
            {t("chat.draft.removeUnavailable")}
          </button>
        </li>
      ))}
    </ul>
  );
}
