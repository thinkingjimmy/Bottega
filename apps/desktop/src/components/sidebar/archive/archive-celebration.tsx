/**
 * [INPUT]: Shared lazy celebration host and native effective motion preferences.
 * [OUTPUT]: Native ArchiveCelebrationHost with the same canvas lifetime as Web.
 * [POS]: ProductApp admission adapter; preference and window ownership stay native.
 */
import { ArchiveCelebrationHost as SharedHost } from "@ai-chat/ui/components/archive/celebration/host";
import type { ComponentProps } from "react";
import { useArchiveConfettiPreference, canPlayArchiveConfetti } from "./archive-preference";
export function ArchiveCelebrationHost(props: Pick<ComponentProps<typeof SharedHost>, "Canvas">) {
  const { enabled } = useArchiveConfettiPreference();
  return <SharedHost {...props} enabled={enabled} canPlay={canPlayArchiveConfetti} />;
}
