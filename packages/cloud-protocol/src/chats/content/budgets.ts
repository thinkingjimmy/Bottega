/**
 * [INPUT]: No runtime dependencies.
 * [OUTPUT]: Provides canonical transcript, tool, attachment and Subagent limits.
 * [POS]: Shared content budget authority consumed by storage, wire validation and rendering.
 */
export const MESSAGE_BYTE_LIMIT = 32 * 1024;
export const MESSAGE_PART_LIMIT = 200;
export const SUBAGENT_DRAFT_LIMIT = 128;
export const SUBAGENT_BYTE_LIMIT = 2 * 1024 * 1024;
export const SUPERSEDED_BRANCH_LIMIT = 8;
export const TOOL_DETAIL_BYTE_LIMIT = 4 * 1024;
export const IMPORTED_TOOL_DETAIL_BYTE_LIMIT = 16 * 1024;
export const ATTACHMENT_LIMIT = 8;
export const ATTACHMENT_FILENAME_BYTE_LIMIT = 255;
export const PART_TITLE_CHAR_LIMIT = 1000;
