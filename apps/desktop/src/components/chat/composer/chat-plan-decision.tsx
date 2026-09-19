/**
 * [INPUT]: Native locale and shared composer controls.
 * [OUTPUT]: ChatPlanDecision with the native host adapter.
 * [POS]: Desktop wrapper; presentation is owned by chat-ui.
 */
import type { ComponentProps } from "react";
import { ChatPlanDecision as Shared } from "@ai-chat/chat-ui/composer-controls/plan-decision";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function ChatPlanDecision(props: Omit<ComponentProps<typeof Shared>, "locale">) {
 const { i18n } = useAppTranslation();
 return <Shared {...props} locale={i18n.language} />;
}
