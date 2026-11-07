/**
 * [INPUT]: Zod and unified persistent member/message contracts.
 * [OUTPUT]: Team plugin snapshots, task CAS, member navigation, deterministic execution identity and renderer bridge.
 * [POS]: Public feature-plugin contract; host owns persistent Chats/process custody, team owns roles/tasks/messages.
 */
import { z } from "zod";
import { pluginIdentitySchema } from "../platform/selection/mode";
import { pluginMemberMessageSchema, pluginMemberSessionSchema } from "../platform/lifecycle";
export { pluginMemberSessionFactsSchema, type PluginMemberSessionFacts } from "./member";
export { teamExecutionId, teamExecutionOwner } from "./identity";
export const pluginTeamTaskSchema = z.object({
  id: pluginIdentitySchema, title: z.string().min(1).max(300), description: z.string().max(16_384),
  ownerMemberId: pluginIdentitySchema.nullable(), dependencies: z.array(pluginIdentitySchema).max(256),
  status: z.enum(["todo", "in-progress", "blocked", "done", "cancelled"]), mergeOperationId: pluginIdentitySchema.optional(), version: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (value.dependencies.includes(value.id) || new Set(value.dependencies).size !== value.dependencies.length)
    context.addIssue({ code: "custom", message: "Task dependencies must be unique and cannot include the task itself" });
});
export const pluginTeamMemberSchema = pluginMemberSessionSchema.extend({
  task: z.string().max(32_768), activeRequestId: pluginIdentitySchema.optional(), stoppedByUser: z.boolean().default(false),
  forkChatId: pluginIdentitySchema.optional(), isolation: z.enum(["shared", "worktree"]).default("shared"),
  workspace: z.string().max(32768).optional(),
});
export const pluginTeamSnapshotSchema = z.object({
  id: pluginIdentitySchema, pluginId: pluginIdentitySchema, leadChatId: pluginIdentitySchema, leadIncarnation: pluginIdentitySchema,
  projectId: pluginIdentitySchema, status: z.enum(["active", "stopping", "stopped", "failed"]), revision: z.number().int().nonnegative(),
  members: z.array(pluginTeamMemberSchema).max(256), tasks: z.array(pluginTeamTaskSchema),
  messages: z.array(pluginMemberMessageSchema), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  error: z.string().max(2048).optional(), concurrentWrites: z.enum(["shared-warning", "isolated"]).default("shared-warning"),
}).strict().superRefine((value, context) => {
  for (const [name, ids] of [["member", value.members.map(item => item.memberId)], ["task", value.tasks.map(item => item.id)], ["message", value.messages.map(item => item.id)]] as const)
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Duplicate team " + name + " identity" });
  if (value.members.some(member => member.pluginId !== value.pluginId || member.leadChatId !== value.leadChatId ||
    member.leadIncarnation !== value.leadIncarnation || member.projectId !== value.projectId))
    context.addIssue({ code: "custom", message: "Team member ownership differs from its Lead and Project" });
});
export type PluginTeamTask = z.infer<typeof pluginTeamTaskSchema>;
export type PluginTeamMember = z.infer<typeof pluginTeamMemberSchema>;
export type PluginTeamSnapshot = z.infer<typeof pluginTeamSnapshotSchema>;
export { PLUGIN_TEAM_CHANNEL } from "./bridge";
export type PluginTeamBridge = Readonly<{
  list(input?: { leadChatId?: string }): Promise<PluginTeamSnapshot[]>;
  get(input: { teamId: string }): Promise<PluginTeamSnapshot | null>;
  createTask(input: { teamId: string; title: string; description?: string; ownerMemberId?: string | null; dependencies?: string[] }): Promise<PluginTeamSnapshot>;
  stopMember(input: { teamId: string; memberId: string }): Promise<PluginTeamSnapshot>;
  openMember(input: { teamId: string; memberId: string }): Promise<{ chatId: string; incarnation: string; projectId: string }>;
  onChanged(listener: (event: { teamId: string; revision: number }) => void): () => void;
}>;
