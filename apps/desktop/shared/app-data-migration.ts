/**
 * [INPUT]: Depends on the canonical cloud-protocol App migrations module.
 * [OUTPUT]: Re-exports declarative Base migration schemas.
 * [POS]: Desktop import boundary; schema ownership lives in the shared package.
 */
export * from "@ai-chat/cloud-protocol/apps/schemas/migrations";
