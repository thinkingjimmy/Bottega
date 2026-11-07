/**
 * [INPUT]: Durable Chat identity registry, main-only blank/worktree creation facts, canonical Project preconditions and trusted Coordinator submit/steer/cancel ports.
 * [OUTPUT]: Persistent sessions, main-only first-create plans, recoverable claims, exact turn outcomes, Provider-aware delivery and cleanup-confirmed stop.
 * [POS]: Generic host session adapter reused by the team feature; never calls ephemeral spawn_subagent.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { agentBackendIdSchema } from "@ai-chat/cloud-protocol/chats/options";
import { pluginMemberSessionSchema, type PluginMemberSession } from "@bottega/contracts/plugins/platform";
import type { PluginMemberSessionFacts } from "@bottega/contracts/plugins/team";
import type { AgentBackendId, AgentTurnOptions, SteerAdmission, SteerIpcReceipt } from "../../../../shared/ipc/agent/agent-ipc";
import type { ManualTurnReceipt, TrustedManualTurnSubmission } from "../../../../shared/ipc/content/sections-ipc";
import type { WorkspacePrecondition } from "../../../../shared/content/submission/submission";
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import { DurableJson } from "../../persistence/durable-json";
import type { PluginTeamSessionPorts, PluginMemberTurnOutcome } from "./service";
import type { NativeMemberFork, NativeMemberForkSource } from "../../library/sessions/member-fork";

const entrySchema = pluginMemberSessionSchema.extend({
  teamId: z.string().min(1).max(128), task: z.string().max(32_768), forkChatId: z.string().max(128).optional(),
  nativeFork: z.object({ backend: z.enum(["codex", "claude"]), sourceChatId: z.string().min(1).max(128),
    sourceIncarnation: z.string().min(1).max(128), sourceMessageRevision: z.number().int().nonnegative(), sourceSessionId: z.string().min(1).max(128) }).strict().optional(),
  lastRequestId: z.string().max(128).optional(),
  lastSettlement: z.object({ requestId: z.string().min(1).max(128), terminal: z.enum(["done", "cancelled", "error"]), cleanup: z.enum(["pending", "complete", "failed"]) }).strict().optional(), isolation: z.enum(["shared", "worktree"]).default("shared"),
});
const fileSchema = z.object({ schemaVersion: z.literal(1), members: z.array(entrySchema) }).strict();
type Entry = z.infer<typeof entrySchema>;
export type PersistentMemberSessionOptions = Readonly<{
  userData: string;
  submit(submission: TrustedManualTurnSubmission): Promise<ManualTurnReceipt>;
  cancel(requestId: string): Promise<unknown>;
  /** Resolves only after the member's real process cleanup finishes. */
  waitForCleanup(requestId: string): Promise<void>;
  cancelPending?(chatId: string): Promise<void>;
  incarnationOf(chatId: string): string | null;
  chatFacts(chatId: string): { agent: string; agentRevision: number; chatRecordRevision: number; executionDir?: string | null; session?: { backend: string; id: string } | null; chatMessageRevision?: number; options: Partial<ChatTurnOptions> } | null;
  workspaceFor(projectId: string): WorkspacePrecondition | null;
  turnOptionsFor(backend: AgentBackendId): AgentTurnOptions;
  currentRequest(chatId: string): { requestId: string } | null;
  steer?(input: SteerAdmission & { memberSession: PluginMemberSessionFacts }): Promise<SteerIpcReceipt>;
  /** Canonical Chat fork plus sealed native continuation where supported. The new Chat keeps its own session identity. */
  forkChat?(input: { memberSession: PluginMemberSessionFacts; pluginId: string; sourceChatId: string; targetChatId: string; targetIncarnationId: string; projectId: string; providerId: AgentBackendId; isolation?: "shared" | "worktree" }): Promise<void | { nativeFork?: NativeMemberForkSource }>;
  now?: () => number;
}>;
export class PersistentMemberSessions implements PluginTeamSessionPorts {
  private readonly file: DurableJson<z.infer<typeof fileSchema>>;
  private readonly now: () => number;
  constructor(readonly options: PersistentMemberSessionOptions) {
    this.now = options.now ?? Date.now;
    this.file = new DurableJson(join(options.userData, "plugin-members.json"), fileSchema, () => ({ schemaVersion: 1, members: [] }));
  }
  async initialize() { await this.file.initialize(); }
  async create(input: Parameters<PluginTeamSessionPorts["create"]>[0]): Promise<PluginMemberSession & { workspace?: string }> {
    if (!this.options.workspaceFor(input.projectId)) throw new Error("Member Project workspace is not available");
    if (!["codex", "claude", "kimi", "opencode"].includes(input.providerId)) throw new Error("Members require a built-in Provider");
    const entry = await this.file.mutate(state => {
      const existing = state.members.find(value => value.pluginId === input.pluginId && value.teamId === input.teamId && value.memberId === input.memberId);
      if (existing) {
        if (existing.leadChatId !== input.leadChatId || existing.leadIncarnation !== input.leadIncarnation || existing.projectId !== input.projectId)
          throw new Error("Persistent member scope differs");
        return existing;
      }
      const entry: Entry = { pluginId: input.pluginId, teamId: input.teamId, leadChatId: input.leadChatId,
        leadIncarnation: input.leadIncarnation, projectId: input.projectId, chatId: randomUUID(), incarnation: randomUUID().replaceAll("-", ""),
        memberId: input.memberId, name: input.name, providerId: input.providerId, task: input.task, isolation: input.isolation ?? "shared", status: "idle", createdAt: this.now(),
        ...(input.forkChatId ? { forkChatId: input.forkChatId } : {}) };
      state.members.push(entry); return entry;
    });
    if (entry.forkChatId && !this.options.incarnationOf(entry.chatId)) {
      try {
        if (!this.options.forkChat) throw new Error("Canonical member Chat fork is unavailable");
        const result = await this.options.forkChat({ memberSession: this.facts(entry.chatId)!, pluginId: entry.pluginId, sourceChatId: entry.forkChatId, targetChatId: entry.chatId, targetIncarnationId: entry.incarnation,
          projectId: entry.projectId, providerId: entry.providerId as AgentBackendId, isolation: entry.isolation });
        await this.file.mutate(state => { const current = state.members.find(value => value.chatId === entry.chatId)!;
          current.status = "idle"; if (result?.nativeFork) current.nativeFork = result.nativeFork; });
        entry.status = "idle";
      } catch (cause) {
        await this.file.mutate(state => { const current = state.members.find(value => value.chatId === entry.chatId && value.incarnation === entry.incarnation);
          if (current) current.status = "failed"; });
        throw cause;
      }
    }
    const actual = this.options.incarnationOf(entry.chatId);
    if (actual && actual !== entry.incarnation) {
      if (!entry.forkChatId) throw new Error("Member Chat incarnation changed");
      await this.file.mutate(state => { state.members.find(value => value.chatId === entry.chatId)!.incarnation = actual; });
      entry.incarnation = actual;
    }
    const metadata = this.options.chatFacts(entry.chatId);
    return { ...this.session(entry), ...(metadata?.executionDir ? { workspace: metadata.executionDir } : {}) };
  }
  prepared(input: { chatId: string; requestId: string }): Promise<boolean> {
    return this.file.mutate(state => {
      const entry = state.members.find(value => value.chatId === input.chatId), current = this.options.currentRequest(input.chatId);
      if (!entry || this.options.incarnationOf(input.chatId) !== entry.incarnation || current?.requestId !== input.requestId) return false;
      const sameRequest = entry.lastRequestId === input.requestId;
      entry.lastRequestId = input.requestId;
      if (!sameRequest || (entry.status !== "stopped" && entry.status !== "stopping")) entry.status = "running";
      return true;
    });
  }
  settled(input: PluginMemberTurnOutcome & { chatId: string }): Promise<"applied" | "duplicate" | "stale"> {
    return this.file.mutate<"applied" | "duplicate" | "stale">(state => {
      const entry = state.members.find(value => value.chatId === input.chatId), current = this.options.currentRequest(input.chatId);
      const previous = entry?.lastSettlement;
      if (!entry || this.options.incarnationOf(input.chatId) !== entry.incarnation || entry.lastRequestId !== input.requestId ||
        (current && current.requestId !== input.requestId)) return "stale";
      if (previous?.requestId === input.requestId && previous.terminal === input.terminal && previous.cleanup === input.cleanup) return "duplicate";
      if ((previous?.requestId === input.requestId && previous.cleanup === "complete") ||
        (entry.status === "stopped" && !current && input.cleanup !== "complete")) return "stale";
      entry.lastSettlement = { requestId: input.requestId, terminal: input.terminal, cleanup: input.cleanup };
      entry.status = input.cleanup !== "complete" ? "stopping" : entry.status === "stopped" ? "stopped" : input.terminal === "done" ? "idle" : "failed";
      return "applied";
    });
  }
  nativeForkFor(input: { chatId: string; incarnationId?: string; backend: string }): NativeMemberFork | undefined {
    const entry = this.file.read(state => state.members.find(value => value.chatId === input.chatId && value.incarnation === input.incarnationId));
    const source = entry?.nativeFork;
    const valid = () => {
      if (!source || source.backend !== input.backend || this.options.incarnationOf(source.sourceChatId) !== source.sourceIncarnation ||
        this.options.currentRequest(source.sourceChatId)) return false;
      const parent = this.options.chatFacts(source.sourceChatId), child = this.options.chatFacts(input.chatId);
      return parent?.agent === source.backend && parent.chatMessageRevision === source.sourceMessageRevision &&
        parent.session?.backend === source.backend && parent.session.id === source.sourceSessionId && !child?.session;
    };
    if (!source || !valid()) return undefined;
    return { ...source, complete: async outcome => {
      if (outcome === "forked" && !valid()) throw new Error("Native member fork source boundary changed");
      await this.file.mutate(state => { const member = state.members.find(value => value.chatId === input.chatId && value.incarnation === input.incarnationId);
        if (!member || member.nativeFork?.sourceSessionId !== source.sourceSessionId) throw new Error("Native member fork owner changed");
        delete member.nativeFork;
      });
    } };
  }
  facts(chatId: string): PluginMemberSessionFacts | null {
    const entry = this.file.read(state => state.members.find(value => value.chatId === chatId));
    return entry ? { pluginId: entry.pluginId, teamId: entry.teamId, leadChatId: entry.leadChatId,
      leadIncarnation: entry.leadIncarnation, memberId: entry.memberId } : null;
  }
  creationFor(chatId: string) {
    return this.file.read(state => { const entry = state.members.find(value => value.chatId === chatId);
      return entry ? { projectId: entry.projectId, incarnationId: entry.incarnation, isolation: entry.isolation } : null; });
  }
  titleOf(chatId: string) { return this.file.read(state => state.members.find(value => value.chatId === chatId)?.name ?? null); }
  entries() { return this.file.read(state => state.members.map(entry => [entry.chatId, this.facts(entry.chatId)!] as const)); }
  async deliver(input: Parameters<PluginTeamSessionPorts["deliver"]>[0]): ReturnType<PluginTeamSessionPorts["deliver"]> {
    const session = input.session;
    const entry = this.file.read(state => state.members.find(value => value.chatId === session.chatId && value.incarnation === session.incarnation));
    const existing = this.options.incarnationOf(session.chatId);
    if (existing && existing !== session.incarnation) throw new Error("Member Chat incarnation changed");
    const workspace = this.options.workspaceFor(session.projectId);
    if (!workspace || workspace.kind !== "project") throw new Error("Member Project workspace is not available");
    const source: PluginMemberSessionFacts = entry ? this.facts(session.chatId)! : {
      pluginId: session.pluginId, teamId: input.teamId, leadChatId: session.leadChatId, leadIncarnation: session.leadIncarnation, memberId: session.memberId,
    };
    const stored = existing ? this.options.chatFacts(session.chatId) : null;
    const provider = session.memberId === "lead" ? stored?.agent ?? session.providerId : session.providerId;
    if (!["codex", "claude", "kimi", "opencode"].includes(provider)) throw new Error("Member Provider is unavailable");
    const current = this.options.currentRequest(session.chatId);
    const content = { schemaVersion: 1 as const, origin: "system" as const, capabilityEpoch: 0, backendEpoch: 0,
      content: { richValue: [], displayText: input.text, files: [] } };
    const createdAt = this.now(), id = "member_" + input.messageId;
    const userMessage = { id: id + "_user", role: "user" as const, content: input.text, createdAt };
    if (current) {
      if (!["codex", "claude"].includes(provider) || !this.options.steer) return { outcome: "not-consumed" };
      const receipt = await this.options.steer({ requestId: current.requestId, outboxRef: userMessage.id, createdAt,
        input: [{ type: "text", text: input.text }], displayText: input.text, content, workspacePrecondition: workspace,
        userMessage, memberSession: source });
      return { outcome: receipt.outcome === "injected" ? "inserted" : receipt.outcome === "unconsumed" ? "queued"
        : receipt.outcome === "ambiguous" ? "unknown" : "not-consumed" };
    }
    const targetProvider = agentBackendIdSchema.parse(provider);
    const storedProvider = stored ? agentBackendIdSchema.parse(stored.agent) : undefined;
    const defaults = stored?.options?.backend === provider ? stored.options as AgentTurnOptions : this.options.turnOptionsFor(provider as AgentBackendId);
    const turnOptions = { ...defaults, mode: { id: "team", pluginId: session.pluginId, name: "Team" } } as AgentTurnOptions;
    const agentSwitch = stored && storedProvider && storedProvider !== targetProvider ? { expectedAgent: storedProvider, expectedAgentRevision: stored.agentRevision,
      expectedChatRecordRevision: stored.chatRecordRevision, targetAgent: targetProvider } : undefined;
    const precondition = existing ? { kind: "existing" as const, incarnationId: existing }
      : { kind: "absent" as const, proposedIncarnationId: session.incarnation };
    if (entry) await this.file.mutate(state => {
      const value = state.members.find(member => member.chatId === session.chatId)!; value.lastRequestId = id; value.status = "running";
    });
    const submission: TrustedManualTurnSubmission = {
      intentId: id, ...(stored ? { expectedAgentRevision: stored.agentRevision } : {}), ...(agentSwitch ? { agentSwitch } : {}),
      persistence: existing ? { kind: "append", input: { chatId: session.chatId, message: userMessage, precondition } }
        : { kind: "create", input: { id: session.chatId, agent: provider as AgentBackendId, options: turnOptions, firstMessage: userMessage,
          incarnationId: session.incarnation, projectId: session.projectId } },
      content, precondition, workspacePrecondition: workspace, memberSession: source,
      turn: { requestId: id, scope: { conversationId: session.chatId }, turnOptions, input: [{ type: "text", text: input.text }] },
    };
    const receipt = await this.options.submit(submission);
    return { outcome: receipt.phase === "failed" ? "not-consumed" : "delivered" };
  }
  async stop(input: { chatId: string; incarnation: string; reason?: "shutdown" }) {
    const actual = this.options.incarnationOf(input.chatId);
    if (actual && actual !== input.incarnation) throw new Error("Member Chat incarnation changed");
    await this.options.cancelPending?.(input.chatId);
    const current = this.options.currentRequest(input.chatId);
    const recorded = this.file.read(state => state.members.find(value => value.chatId === input.chatId && value.incarnation === input.incarnation));
    const requestId = current?.requestId ?? recorded?.lastRequestId;
    if (requestId) { await this.options.cancel(requestId); await this.options.waitForCleanup(requestId); }
    if (recorded) await this.file.mutate(state => {
      const value = state.members.find(member => member.chatId === input.chatId)!;
      if (value.lastSettlement) value.lastSettlement.cleanup = "complete";
      if (input.reason !== "shutdown") value.status = "stopped";
      else if (value.status !== "failed" && value.status !== "stopped") value.status = value.lastSettlement && value.lastSettlement.terminal !== "done" ? "failed" : "idle";
    });
  }
  async status(input: { chatId: string; incarnation: string }): Promise<PluginMemberSession["status"]> {
    const actual = this.options.incarnationOf(input.chatId);
    if (actual && actual !== input.incarnation) return "failed";
    const entry = this.file.read(state => state.members.find(value => value.chatId === input.chatId && value.incarnation === input.incarnation));
    if (this.options.currentRequest(input.chatId)) return entry?.status === "stopping" ? "stopping" : "running";
    if (entry?.status === "running") return "stopping";
    return entry?.status ?? "idle";
  }
  async recover(input: { pluginId: string; leadChatId: string; leadIncarnation: string }) {
    const entries = this.file.read(state => state.members.filter(entry => entry.pluginId === input.pluginId && entry.leadChatId === input.leadChatId && entry.leadIncarnation === input.leadIncarnation));
    return Promise.all(entries.map(async entry => ({ ...this.session(entry), task: entry.task, isolation: entry.isolation,
      ...(entry.forkChatId ? { forkChatId: entry.forkChatId } : {}), status: await this.status({ chatId: entry.chatId, incarnation: entry.incarnation }) })));
  }
  private session(entry: Entry): PluginMemberSession {
    const { teamId: _teamId, task: _task, forkChatId: _forkChatId, lastRequestId: _lastRequestId, lastSettlement: _lastSettlement, isolation: _isolation, nativeFork: _nativeFork, ...session } = entry; return session;
  }
  close() { return this.file.closeAndFlush(); }
}
export async function createPersistentMemberSessions(options: PersistentMemberSessionOptions) {
  const sessions = new PersistentMemberSessions(options); await sessions.initialize(); return sessions;
}
