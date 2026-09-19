/**
 * [INPUT]: Native locale and shared composer controls.
 * [OUTPUT]: ChatPermissionSelector with the native host adapter.
 * [POS]: Desktop wrapper; presentation is owned by chat-ui.
 */
import type { ComponentProps } from "react";
import { ChatPermissionSelector as Shared } from "@ai-chat/chat-ui/composer-controls/permission";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { acknowledgeFullAccess } from "@/lib/settings-client";
import { openExternal } from "@/lib/agent-client";
export function ChatPermissionSelector(props: Omit<ComponentProps<typeof Shared>, "locale">) {
 const { i18n } = useAppTranslation();
 return <Shared {...props} locale={i18n.language} acknowledgeFullAccess={acknowledgeFullAccess} openExternal={openExternal} />;
}
