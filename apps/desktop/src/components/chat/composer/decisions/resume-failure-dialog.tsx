/**
 * [INPUT]: Native recovery controller and locale provider.
 * [OUTPUT]: The shared recovery dialog with native translations and authority.
 * [POS]: apps/desktop/src/components/chat/composer/decisions; Desktop adapter; the shared package owns every recovery view.
 */
import { ResumeFailureDialog as SharedDialog, type ResumeFailureController } from "@ai-chat/chat-ui/interactions/recovery";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
export function ResumeFailureDialog({ controller }: { controller: ResumeFailureController }) {
  const { t } = useAppTranslation(); return <SharedDialog controller={controller} translate={t} />;
}
