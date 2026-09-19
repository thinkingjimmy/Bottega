/**
 * [INPUT]: Shared queue presentation and native locale subscription.
 * [OUTPUT]: Native MessageQueuePanel adapter preserving the existing component contract.
 * [POS]: Thin composer adapter; interaction and layout belong to chat-ui.
 */
import { MessageQueuePanel as Shared } from "@ai-chat/chat-ui/queue/message-queue-panel";
import type { QueueItem } from "@/lib/message-queue-model";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function MessageQueuePanel(props: Omit<Parameters<typeof Shared<QueueItem>>[0], "t">) {
  const { t } = useAppTranslation(); return <Shared {...props} t={t} />;
}
