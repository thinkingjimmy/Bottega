/**
 * [INPUT]: Portable user/reply summaries, canonical outline entries and the shared Conversation scroll context.
 * [OUTPUT]: Shared transcript minimap with roving keyboard focus, previews and native scroll behavior.
 * [POS]: Transport-independent outline presentation; host adapters own canonical outline paging.
 */
export { outlineEntries, outlineMinimapEntries, activeOutlineIndex, type OutlineEntry } from "@ai-chat/chat-ui/timeline/outline-model";
