/**
 * [INPUT]: Shared archive canvas and native playback eligibility.
 * [OUTPUT]: Native ArchiveCanvas adapter with injectable renderer for lifecycle checks.
 * [POS]: Native motion preference boundary around the shared visual implementation.
 */
import { ArchiveCanvas as SharedCanvas } from "@ai-chat/ui/components/archive/celebration/canvas";
import type { ComponentProps } from "react";
import { canPlayArchiveConfetti } from "./archive-preference";
export function ArchiveCanvas(props: Omit<ComponentProps<typeof SharedCanvas>, "canPlay">) {
  return <SharedCanvas {...props} canPlay={canPlayArchiveConfetti} />;
}
