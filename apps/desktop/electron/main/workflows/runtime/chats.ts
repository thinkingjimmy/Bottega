/**
 * [INPUT]: Depends on DurableJson and the workflow run contract's record shape.
 * [OUTPUT]: Provides WorkflowChatRegistry (`<root>/chats.json`): one persistent Chat per record × role, reused by every run and rework run of that record; roleOf (which Chats every Chat list leaves out) and titleOf (the fixed title a workflow Chat is created with); the Chat of a role for a record.
 * [POS]: The workflow runtime's Chat index, loaded by the foundation before any window lists Chats (06 §4, plan maintenance 2026-09-25: Chats scoped to record × role, hidden from the Chat list, opened from the run detail and the record's Workflow block).
 */
import { join } from "node:path";
import { z } from "zod";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import type { WorkflowRun } from "@ai-chat/cloud-protocol/contracts/workflow/run";
import { DurableJson } from "../../persistence/durable-json";

const entrySchema = z.object({ recordKey: z.string().min(1).max(512), role: z.enum(["plan", "develop", "review"]), chatId: z.string().min(1).max(128),
  incarnationId: z.string().regex(/^[a-f0-9]{32}$/), createdAt: z.number().int(),
  /** Fixed at claim ("{role} · {task}", interface language): the Chat is created with it and never goes to title generation. */
  title: z.string().max(300).default("") }).strict();
const fileSchema = z.object({ schemaVersion: z.literal(1), chats: z.array(entrySchema).max(30_000) }).strict();
export const recordKeyOf = (record: WorkflowRun["record"]) => `${record.base.ownerKey}\u0000${record.base.ownerInstanceId}\u0000${record.rowId}`;

export class WorkflowChatRegistry {
  private readonly file: DurableJson<z.infer<typeof fileSchema>>;
  /* Asked for every Chat summary the product builds, so it is a map, not a scan. */
  private roles = new Map<string, { role: WorkflowRoleName; title: string }>();
  constructor(root: string) { this.file = new DurableJson(join(root, "chats.json"), fileSchema, () => ({ schemaVersion: 1, chats: [] })); }
  async initialize() {
    await this.file.initialize();
    this.roles = new Map(this.file.read(state => state.chats.map(item => [item.chatId, { role: item.role, title: item.title }] as const)));
  }
  closeAndFlush() { return this.file.closeAndFlush(); }
  get(record: WorkflowRun["record"], role: WorkflowRoleName) {
    const key = recordKeyOf(record);
    return this.file.read(state => state.chats.find(item => item.recordKey === key && item.role === role) ?? null);
  }
  /** Recorded before the Chat's first turn is submitted, so a crash in between still finds it (and never makes a second one). */
  async claim(record: WorkflowRun["record"], role: WorkflowRoleName, chat: { chatId: string; incarnationId: string; title: string }, now: number) {
    const key = recordKeyOf(record);
    const entry = await this.file.mutate(state => {
      const existing = state.chats.find(item => item.recordKey === key && item.role === role);
      if (existing) return existing;
      const entry = { recordKey: key, role, ...chat, createdAt: now };
      state.chats.push(entry);
      return entry;
    });
    this.roles.set(entry.chatId, { role: entry.role, title: entry.title });
    return entry;
  }
  /** The role of a Chat a workflow owns, or null for every other Chat. */
  roleOf(chatId: string) { return this.roles.get(chatId)?.role ?? null; }
  /** Every workflow Chat and its role (R-35: the cloud repair sets a role a Chat's cloud head lacks). */
  entries(): Array<readonly [string, WorkflowRoleName]> { return [...this.roles].map(([chatId, value]) => [chatId, value.role] as const); }
  /** The title a workflow Chat is created with, or null (every other Chat is titled the usual way). */
  titleOf(chatId: string) { return this.roles.get(chatId)?.title || null; }
}
