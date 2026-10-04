/**
 * [INPUT]: Native locale, shared composer controls, and this window's role.
 * [OUTPUT]: ChatPermissionSelector with the native host adapter; in an App window, Full Access is acknowledged for the Chat resident there.
 * [POS]: apps/desktop/src/components/chat/composer/agents; Desktop wrapper; presentation is owned by chat-ui.
 */
import type { ComponentProps } from "react";
import { ChatPermissionSelector as Shared } from "@ai-chat/chat-ui/composer-controls/permission";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { acknowledgeFullAccess } from "@/lib/settings/client/settings-client";
import { openExternal } from "@/lib/agent/agent-client";
import { windowContext } from "@/lib/platform/window-surfaces-client";
/* Main admits an App window's acknowledgement only for the Chat resident in it (OPT-48, 4dcc3100b); the main window
   keeps acknowledging with no argument. */
export function ChatPermissionSelector({ chatId, ...props }: Omit<ComponentProps<typeof Shared>, "locale"> & { chatId: string }) {
 const { i18n } = useAppTranslation();
 const acknowledge = () => acknowledgeFullAccess(windowContext().role === "app-window" ? { chatId } : undefined);
 return <Shared {...props} locale={i18n.language} acknowledgeFullAccess={acknowledge} openExternal={openExternal} />;
}
