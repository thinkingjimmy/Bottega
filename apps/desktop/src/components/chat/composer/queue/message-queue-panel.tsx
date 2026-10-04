/**
 * [INPUT]: Shared queue presentation and native locale subscription.
 * [OUTPUT]: Native MessageQueuePanel adapter preserving the existing component contract;  a held item gets its missing-file note, and a restored queue its restored-paused header.
 * [POS]: Thin composer adapter; interaction and layout belong to chat-ui.
 */
import { MessageQueuePanel as Shared } from "@ai-chat/chat-ui/queue/message-queue-panel";
import type { QueueItem } from "@/lib/chat/session/message-queue-model";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useComposerState } from "@/lib/chat/state/composer/chat-composer-store";
export function MessageQueuePanel({ chatId, ...props }: Omit<Parameters<typeof Shared<QueueItem>>[0], "t" | "pausedReason"> & { chatId: string }) {
  const { t } = useAppTranslation();
  // A queue restored after a restart says so, and that it waits for the person (F-12).
  const restored = useComposerState(chatId).queue.restored;
  // A held item says which file it is waiting for; the shared row only shows the note.
  const items = props.items.map((item) => item.unavailableAttachment ? { ...item, note: t("chat.draft.fileUnavailable", { name: item.unavailableAttachment }) } : item);
  return <Shared {...props} items={items} t={t} pausedReason={restored ? t("chat.queue.restoredPaused", { count: restored }) : undefined} />;
}
