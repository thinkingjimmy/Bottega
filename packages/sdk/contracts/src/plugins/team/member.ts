/**
 * [INPUT]: Zod and the lightweight canonical plugin identity schema.
 * [OUTPUT]: Immutable portable PluginMemberSessionFacts and its validator.
 * [POS]: Chat persistence and encrypted sync leaf; does not initialize team snapshots or plugin declarations.
 */
import { z } from "zod";
import { pluginIdentitySchema } from "../platform/selection/mode";
export const pluginMemberSessionFactsSchema = z.object({
  pluginId: pluginIdentitySchema, teamId: pluginIdentitySchema, leadChatId: pluginIdentitySchema,
  leadIncarnation: pluginIdentitySchema, memberId: pluginIdentitySchema,
}).strict();
export type PluginMemberSessionFacts = z.infer<typeof pluginMemberSessionFactsSchema>;
