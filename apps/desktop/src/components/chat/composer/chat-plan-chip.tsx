/**
 * [INPUT]: Depends on lucide Plan/X icons with the Shared Button original and alignment of the permissions selector trigger geometry
 * [OUTPUT]: Provides ChatPlanChip, hover/focus switches to close icons without transition
 * [POS]: The temporary Plan intent control of the chat/composer; The separation lines are sorted by parent level, and the button vision is synchronized with the permission trigger
 */

import { LightbulbIcon, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";

export function ChatPlanChip({ onClose }: { onClose: () => void }) {
  return (
    <Button
      aria-label="关闭 Plan"
      className="group/plan h-8 gap-1.5 rounded-full px-1.5 font-normal text-sm text-muted-foreground transition-none"
      onClick={onClose}
      size="sm"
      title="关闭 Plan"
      type="button"
      variant="ghost"
    >
      <LightbulbIcon className="size-4 shrink-0 group-hover/plan:hidden group-focus-visible/plan:hidden" />
      <XIcon className="hidden size-4 shrink-0 group-hover/plan:block group-focus-visible/plan:block" />
      <span>Plan</span>
    </Button>
  );
}
