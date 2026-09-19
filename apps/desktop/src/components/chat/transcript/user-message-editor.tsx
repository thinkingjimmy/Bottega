/**
 * [INPUT]: Shared revision editor and native translation context.
 * [OUTPUT]: Native UserMessageEditor with shared layout and error handling.
 * [POS]: Transcript adapter; revision eligibility remains with the session.
 */
import { UserMessageEditor as SharedEditor } from "@ai-chat/chat-ui/interactions/edit";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function UserMessageEditor(props: Omit<Parameters<typeof SharedEditor>[0], "t">) {
  const { t } = useAppTranslation(); return <SharedEditor {...props} t={t} />;
}
