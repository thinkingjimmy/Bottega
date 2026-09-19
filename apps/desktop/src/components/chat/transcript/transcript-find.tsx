/**
 * [INPUT]: Shared find UI, native Chat find IPC, shortcut registry and translator.
 * [OUTPUT]: Native TranscriptFind with revision-fenced pages and original keyboard scope.
 * [POS]: Thin native platform adapter for the shared transcript search.
 */
import { TranscriptFind as SharedFind } from "@ai-chat/chat-ui/transcript-find";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { matchShortcut } from "@/lib/shortcuts";
import { localChatReads } from "@/lib/cloud/chat/platform/local";
import { hasModalKeyboardScope } from "@/lib/modal-keyboard/scope";
const matchesShortcut = (event: KeyboardEvent) => matchShortcut(event, "findInChat");
export function TranscriptFind(props: { chatId: string; jumpTo(id: string): void; surfaceVisible: boolean }) {
  const { t } = useAppTranslation();
  return <SharedFind {...props} t={t} find={localChatReads.transcript.find} matchesShortcut={matchesShortcut} keyboardBlocked={hasModalKeyboardScope} />;
}
