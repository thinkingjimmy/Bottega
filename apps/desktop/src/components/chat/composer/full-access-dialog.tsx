/**
 * [INPUT]: Native locale and shared composer controls.
 * [OUTPUT]: FullAccessDialog with the native host adapter.
 * [POS]: Desktop wrapper; presentation is owned by chat-ui.
 */
import type { ComponentProps } from "react";
import { FullAccessDialog as Shared } from "@ai-chat/chat-ui/composer-controls/full-access";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function FullAccessDialog(props: Omit<ComponentProps<typeof Shared>, "locale">) {
 const { i18n } = useAppTranslation();
 return <Shared {...props} locale={i18n.language} />;
}
