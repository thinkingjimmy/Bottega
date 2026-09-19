/**
 * [INPUT]: Depends on the shared imported-history projection.
 * [OUTPUT]: Exposes the common budgeted tool/process projection to SQLite history readers.
 * [POS]: Native import adapter; original field content remains retained in storage.
 */
export { projectForeignParts, projectForeignTools } from "@ai-chat/cloud-protocol/chats/imported/projection";
