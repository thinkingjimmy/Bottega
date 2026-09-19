/**
 * [INPUT]: Depends on shared conversation activity grouping and native draft part types.
 * [OUTPUT]: Exposes the common grouping and summaries with native payload types.
 * [POS]: Native adapter; Web and Electron consume the same activity projection.
 */
import type { DraftPart, DraftToolPart } from "../../shared/chat-turn-reducer";
import type { PartGroup as SharedPartGroup } from "@ai-chat/ui/components/conversation/activity/groups";
export { groupParts, groupSummary } from "@ai-chat/ui/components/conversation/activity/groups";
export type GroupedToolPart = DraftToolPart & { merged?: boolean };
export type PartGroup = SharedPartGroup<DraftPart>;
