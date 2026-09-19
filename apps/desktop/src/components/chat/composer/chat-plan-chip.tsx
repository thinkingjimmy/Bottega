/**
 * [INPUT]: Native locale and shared composer controls.
 * [OUTPUT]: ChatPlanChip with the native host adapter.
 * [POS]: Desktop wrapper; presentation is owned by chat-ui.
 */
import type { ComponentProps } from "react";
import { ChatPlanChip as Shared } from "@ai-chat/chat-ui/composer-controls/plan-chip";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function ChatPlanChip(props: Omit<ComponentProps<typeof Shared>, "locale">) {
 const { i18n } = useAppTranslation();
 return <Shared {...props} locale={i18n.language} />;
}
