/**
 * [INPUT]: Depends on portable parts, failures and Subagent metadata.
 * [OUTPUT]: Provides closed live item and Subagent schemas and types.
 * [POS]: Shared live vocabulary; session authority and filesystem provenance are absent.
 */
import { z } from "zod";
import { productFailureSchema } from "../chats/content/failure";
import { persistedSubagentSchema } from "../chats/content/messages";
import { utf8Length } from "../chats/content/parts";
import { MESSAGE_BYTE_LIMIT, TOOL_DETAIL_BYTE_LIMIT, PART_TITLE_CHAR_LIMIT } from "../chats/content/budgets";
export const agentTurnItemSchema = z.object({ itemId: z.string().min(1).max(256),
  kind: z.enum(["agent-message", "plan", "command", "file-change", "file-read", "web-search", "image", "reasoning", "agent-failure", "user-input", "other"]),
  text: z.string().refine(value => utf8Length(value) <= MESSAGE_BYTE_LIMIT).optional(),
  title: z.string().max(PART_TITLE_CHAR_LIMIT), detail: z.string().refine(value => utf8Length(value) <= TOOL_DETAIL_BYTE_LIMIT).optional(),
  status: z.enum(["running", "completed", "failed"]), failure: productFailureSchema.optional(), severity: z.enum(["warning", "error"]).optional(),
}).strict();
export const liveSubagentMetaSchema = persistedSubagentSchema.shape.meta.extend({
  status: z.enum(["pendingInit", "running", "notFound", "completed", "errored", "shutdown", "interrupted"]),
});
export type AgentTurnItem = z.infer<typeof agentTurnItemSchema>;
export type AgentSubagentMeta = z.infer<typeof liveSubagentMetaSchema>;
export type AgentSubagentStatus = AgentSubagentMeta["status"];
