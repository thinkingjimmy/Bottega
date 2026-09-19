/**
 * [INPUT]: Shared queue presentation and native locale subscription.
 * [OUTPUT]: Native MessageQueueRow adapter preserving the existing component contract.
 * [POS]: Thin composer adapter; interaction and layout belong to chat-ui.
 */
import { MessageQueueRow as Shared } from "@ai-chat/chat-ui/queue/message-queue-row";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function MessageQueueRow(props: Omit<Parameters<typeof Shared>[0], "t">) {
  const { t } = useAppTranslation(); return <Shared {...props} t={t} />;
}
