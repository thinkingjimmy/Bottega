"use client";

/**
 * [INPUT]: Depends on i18n common.loadingView copy and the shared Skeleton primitive
 * [OUTPUT]: Provides ChatTranscriptSkeleton, the placeholder shown while an existing conversation hydrates
 * [POS]: components/chat/transcript's loading face; it mirrors ChatTranscript's column geometry so the real messages land where the placeholder stood, and never appears for a draft that has no history to wait for
 */

import { ConversationSkeleton } from "@ai-chat/ui/components/conversation/skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function ChatTranscriptSkeleton() {
  const { t } = useAppTranslation();
  return <ConversationSkeleton label={t("common.loadingView")} />;
}
