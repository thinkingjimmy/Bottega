/**
 * [INPUT]: Durable feature store, the canonical host Provider catalog, persistent member host port and shared team/message contracts.
 * [OUTPUT]: Team ownership, durable request-bound member outcomes, cleanup-safe task/group release, failed-stop retries, readiness-gated durable claim/queue recovery, message delivery/inbox/ack and task CAS.
 * [POS]: Official team feature runtime; does not reuse ephemeral subagents or change Workflow behavior.
 */
import { randomUUID } from "node:crypto";
import { MESSAGE_BYTE_LIMIT } from "@ai-chat/cloud-protocol/chats/content/budgets";
import { teamExecutionId, teamExecutionOwner } from "@bottega/contracts/plugins/team/identity";
import { pluginTeamMemberSchema, type PluginTeamSnapshot, type PluginTeamTask } from "@bottega/contracts/plugins/team";
import type { PluginMemberSession } from "@bottega/contracts/plugins/platform";
import { PluginTeamStore } from "./store";
import { PluginTeamDelivery } from "./delivery";
import { builtinProviderCatalog, knownBackend } from "../../../../shared/providers/catalog";
export type PluginMemberTurnOutcome = Readonly<{ requestId: string; terminal: "done" | "cancelled" | "error"; cleanup: "pending" | "complete" | "failed" }>;
export type PluginTeamSessionPorts = Readonly<{
  prepared?(input: { chatId: string; requestId: string }): Promise<boolean>;
  settled?(input: PluginMemberTurnOutcome & { chatId: string }): Promise<"applied" | "duplicate" | "stale">;
  create(input: { pluginId: string; teamId: string; leadChatId: string; leadIncarnation: string; projectId: string; memberId: string;
    name: string; providerId: string; task: string; forkChatId?: string; isolation?: "shared" | "worktree" }): Promise<PluginMemberSession & { task?: string; workspace?: string }>;
  deliver(input: { session: PluginMemberSession; teamId: string; messageId: string; text: string }): Promise<{ outcome: "inserted" | "delivered" | "queued" | "unknown" | "not-consumed" }>;
  stop(input: { chatId: string; incarnation: string; reason?: "shutdown" }): Promise<void>;
  status(input: { chatId: string; incarnation: string }): Promise<PluginMemberSession["status"]>;
  recover(input: { pluginId: string; leadChatId: string; leadIncarnation: string }): Promise<Array<PluginMemberSession & { task?: string; forkChatId?: string; isolation?: "shared" | "worktree" }>>;
}>;
export type PluginTeamServiceOptions = Readonly<{
  userData: string; sessions: PluginTeamSessionPorts; now?: () => number; coalesceMs?: number;
  projectReady?(projectId: string): boolean;
  canDeliver?(team: PluginTeamSnapshot): boolean;
  leadSession?(team: PluginTeamSnapshot): PluginMemberSession | null;
  retainGroup?(input: { teamId: string; projectId: string; owner: { kind: "team"; id: string }; signal?: AbortSignal }): Promise<{ release(): Promise<void> } | null>;
}>;
export class PluginTeamService {
  private readonly store: PluginTeamStore;
  private readonly delivery: PluginTeamDelivery;
  private readonly now: () => number;
  private readonly listeners = new Set<(event: { teamId: string; revision: number }) => void>();
  private readonly groupAcquisitions = new Map<string, Promise<void>>();
  private readonly groupReleases = new Map<string, Promise<void>>();
  private readonly groupHolds = new Map<string, { release(): Promise<void> }>();
  private readonly resuming = new Map<string, Promise<void>>();
  private readonly groupControllers = new Map<string, AbortController>();
  private readonly adding = new Map<string, Promise<PluginTeamSnapshot>>();
  private closed = false;
  constructor(readonly options: PluginTeamServiceOptions) {
    this.now = options.now ?? Date.now;
    this.store = new PluginTeamStore(options.userData, this.now);
    this.delivery = new PluginTeamDelivery({ store: this.store, sessions: options.sessions, now: this.now,
      coalesceMs: options.coalesceMs ?? 1_000, canDeliver: options.canDeliver, changed: id => this.changed(id), leadSession: options.leadSession });
  }
  async initialize() {
    await this.store.initialize();
    for (const team of this.store.list()) if (team.status === "active") {
      await this.reconcile(team.id);
      const current = this.require(team.id);
      if (current.members.some(member => ["running", "stopping"].includes(member.status)) || current.tasks.some(task => task.status === "in-progress")) await this.retainGroup(current);
    }
    await this.resume();
  }
  async resume(pluginId?: string) {
    if (this.closed) return;
    for (const team of this.list().filter(value => value.status === "active" && (!pluginId || value.pluginId === pluginId))) {
      if (this.options.canDeliver && !this.options.canDeliver(team)) continue;
      let operation = this.resuming.get(team.id);
      if (!operation) {
        operation = this.resumeTeam(team).finally(() => { if (this.resuming.get(team.id) === operation) this.resuming.delete(team.id); });
        this.resuming.set(team.id, operation);
      }
      await operation;
    }
  }
  private async resumeTeam(team: PluginTeamSnapshot) {
    try {
      for (const claim of await this.options.sessions.recover(team)) {
        if (this.closed || this.require(team.id).status !== "active" || this.options.canDeliver && !this.options.canDeliver(this.require(team.id))) return;
        if (this.require(team.id).members.some(member => member.memberId === claim.memberId) || claim.task === undefined || claim.status !== "idle") continue;
        await this.addMember({ teamId: team.id, memberId: claim.memberId, name: claim.name, providerId: claim.providerId,
          task: claim.task, forkChatId: claim.forkChatId, isolation: claim.isolation });
      }
      if (this.closed || this.require(team.id).status !== "active") return;
      await this.store.update(team.id, current => { for (const member of current.members) if (!member.stoppedByUser && member.status !== "stopped") this.queueInitial(current, member); });
      const current = this.require(team.id);
      if (current.messages.some(message => message.status === "queued" && !message.consumptionId)) {
        await this.retainGroup(current); this.assertOpen();
        if (this.require(team.id).status === "active") await this.delivery.flush(team.id);
        await this.releaseIdleGroup(team.id);
      }
    } catch (cause) {
      if (!this.closed) { await this.store.update(team.id, current => { current.error = "Member recovery failed: " + String(cause).slice(0, 1900); }); this.changed(team.id); }
    }
  }
  list(input: { leadChatId?: string } = {}) { return this.store.list().filter(team => !input.leadChatId || team.leadChatId === input.leadChatId); }
  get(teamId: string) { return this.store.get(teamId); }
  onChanged(listener: (event: { teamId: string; revision: number }) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  teamForChat(chatId: string) { return this.store.list().filter(team => team.leadChatId === chatId || team.members.some(member => member.chatId === chatId))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.createdAt - a.createdAt)[0] ?? null; }
  memberFacts(chatId: string) {
    const team = this.store.list().find(value => value.members.some(member => member.chatId === chatId));
    const member = team?.members.find(value => value.chatId === chatId);
    return team && member ? { pluginId: team.pluginId, teamId: team.id, leadChatId: team.leadChatId, leadIncarnation: team.leadIncarnation, memberId: member.memberId } : null;
  }
  authoringOwnerForChat(chatId: string) {
    const team = this.teamForChat(chatId);
    return team?.status === "active" ? teamExecutionOwner(team.pluginId, team.leadChatId, team.leadIncarnation) : null;
  }
  async create(input: { pluginId: string; leadChatId: string; leadIncarnation: string; projectId: string }) {
    this.assertOpen();
    if (this.options.projectReady && !this.options.projectReady(input.projectId)) throw new Error("Team Project is not available");
    if (this.memberFacts(input.leadChatId)) throw new Error("Nested teams are not supported");
    const id = teamExecutionId(input.pluginId, input.leadChatId, input.leadIncarnation);
    const previous = this.get(id);
    if (previous && previous.projectId !== input.projectId) throw new Error("A team cannot change its Project");
    const now = this.now();
    const team = await this.store.add({ id, ...input, status: "active", revision: 0, members: [], tasks: [], messages: [],
      createdAt: now, updatedAt: now, concurrentWrites: "shared-warning" });
    this.changed(id); return team;
  }
  addMember(input: { teamId: string; memberId?: string; name: string; providerId: string; task: string; forkChatId?: string; isolation?: "shared" | "worktree" }): Promise<PluginTeamSnapshot> {
    const memberId = input.memberId ?? randomUUID(), key = input.teamId + ":" + memberId;
    const pending = this.adding.get(key); if (pending) return pending;
    const operation = this.createMember({ ...input, memberId }).finally(async () => {
      if (this.adding.get(key) === operation) this.adding.delete(key);
      await this.releaseIdleGroup(input.teamId);
    });
    this.adding.set(key, operation);
    return operation;
  }
  private async createMember(input: { teamId: string; memberId: string; name: string; providerId: string; task: string; forkChatId?: string; isolation?: "shared" | "worktree" }) {
    this.assertOpen(); const team = this.requireActive(input.teamId);
    if (!input.task || Buffer.byteLength(input.task, "utf8") > MESSAGE_BYTE_LIMIT) throw new Error("Member task exceeds its body budget");
    if (!knownBackend(builtinProviderCatalog, input.providerId)) throw new Error("Team members require a built-in Provider");
    const existing = team.members.find(member => member.memberId === input.memberId);
    if (existing) {
      if (existing.stoppedByUser) {
        await this.store.update(team.id, current => {
          if (current.status !== "active") throw new Error("Team stopped before member resume");
          if (current.members.filter(value => !value.stoppedByUser && value.status !== "stopped").length >= 8) throw new Error("A team supports at most 8 active members");
          const member = current.members.find(value => value.memberId === input.memberId)!;
          member.stoppedByUser = false; member.status = "idle"; member.task = input.task;
        });
        await this.retainGroup(team);
        await this.send({ teamId: team.id, id: "resume_" + randomUUID(), senderChatId: team.leadChatId, memberId: input.memberId, body: input.task });
        await this.delivery.flush(team.id);
      }
      return this.require(team.id);
    }
    if (team.members.filter(member => !member.stoppedByUser && member.status !== "stopped").length >= 8) throw new Error("A team supports at most 8 active members");
    if (!input.name.trim() || team.members.some(member => member.name.toLowerCase() === input.name.trim().toLowerCase())) throw new Error("Member names must be nonempty and unique");
    await this.retainGroup(team); this.assertOpen(); this.requireActive(team.id);
    const session = await this.options.sessions.create({ ...input, pluginId: team.pluginId, leadChatId: team.leadChatId,
      leadIncarnation: team.leadIncarnation, projectId: team.projectId });
    const member = pluginTeamMemberSchema.parse({
      pluginId: session.pluginId, leadChatId: session.leadChatId, leadIncarnation: session.leadIncarnation, projectId: session.projectId,
      chatId: session.chatId, incarnation: session.incarnation, memberId: session.memberId, name: session.name,
      providerId: session.providerId, status: session.status, createdAt: session.createdAt, task: input.task,
      stoppedByUser: false, isolation: input.isolation ?? "shared", ...(session.workspace ? { workspace: session.workspace } : {}), ...(input.forkChatId ? { forkChatId: input.forkChatId } : {}),
    });
    try {
      await this.store.update(team.id, current => {
        if (current.status !== "active") throw new Error("Team stopped before member creation");
        if (current.members.some(value => value.memberId === member.memberId)) return;
        if (current.members.some(value => value.name.toLowerCase() === member.name.toLowerCase())) throw new Error("Member names must be unique");
        if (current.members.filter(value => !value.stoppedByUser && value.status !== "stopped").length >= 8) throw new Error("A team supports at most 8 active members");
        current.members.push(member); this.queueInitial(current, member);
        current.concurrentWrites = current.members.every(value => value.isolation === "worktree") ? "isolated" : "shared-warning";
      });
    } catch (cause) {
      await this.options.sessions.stop({ chatId: session.chatId, incarnation: session.incarnation });
      throw cause;
    }
    this.changed(team.id);
    await this.delivery.flush(team.id);
    this.changed(team.id);
    return this.require(team.id);
  }
  private queueInitial(team: PluginTeamSnapshot, member: PluginTeamSnapshot["members"][number]) {
    const id = "initial_" + member.memberId;
    if (team.messages.some(message => message.id === id)) return;
    if (team.messages.filter(message => !["processed", "cancelled"].includes(message.status)).length >= 2048) throw new Error("Team inbox is full; acknowledge completed messages");
    team.messages.push({ id, pluginId: team.pluginId, leadChatId: team.leadChatId, leadIncarnation: team.leadIncarnation,
      senderChatId: team.leadChatId, targetChatId: member.chatId, targetIncarnation: member.incarnation,
      body: member.task, status: "queued", createdAt: this.now() });
  }
  async send(input: { teamId: string; id: string; senderChatId: string; memberId: string; body: string }) {
    this.assertOpen();
    if (!input.body || Buffer.byteLength(input.body, "utf8") > MESSAGE_BYTE_LIMIT) throw new Error("Team message exceeds its body budget");
    const team = this.requireActive(input.teamId);
    const target = team.members.find(member => member.memberId === input.memberId) ??
      (input.memberId === "lead" ? this.options.leadSession?.(team) : null);
    if (!target || target.status === "stopped" || ("stoppedByUser" in target && target.stoppedByUser)) throw new Error("Target member is not available");
    if (input.senderChatId !== team.leadChatId && !team.members.some(member => member.chatId === input.senderChatId)) throw new Error("Sender does not belong to this team");
    await this.retainGroup(team); this.assertOpen();
    await this.store.update(team.id, current => {
      const existing = current.messages.find(message => message.id === input.id);
      if (existing) {
        if (existing.body !== input.body || existing.senderChatId !== input.senderChatId || existing.targetChatId !== target.chatId) throw new Error("Message identity was reused with different content");
        return;
      }
      if (current.messages.filter(message => !["processed", "cancelled"].includes(message.status)).length >= 2048) throw new Error("Team inbox is full; acknowledge completed messages");
      current.messages.push({ id: input.id, pluginId: team.pluginId, leadChatId: team.leadChatId, leadIncarnation: team.leadIncarnation,
        senderChatId: input.senderChatId, targetChatId: target.chatId, targetIncarnation: target.incarnation, body: input.body, status: "queued", createdAt: this.now() });
    });
    this.changed(team.id); this.delivery.schedule(team.id);
    return this.require(team.id);
  }
  flush(teamId: string) { return this.delivery.flush(teamId); }
  inbox(input: { teamId: string; memberChatId: string; incarnation: string }) { return this.delivery.inbox(input); }
  async acknowledge(input: { teamId: string; memberChatId: string; incarnation: string; ids: string[]; consumptionId: string }) {
    await this.delivery.acknowledge(input); return this.require(input.teamId);
  }
  async createTask(input: { teamId: string; title: string; description?: string; ownerMemberId?: string | null; dependencies?: string[] }) {
    this.requireActive(input.teamId);
    await this.store.update(input.teamId, team => {
      if (!input.title.trim()) throw new Error("Task title is required");
      if (team.tasks.filter(task => !["done", "cancelled"].includes(task.status)).length >= 256) throw new Error("A team supports at most 256 active tasks");
      if (input.ownerMemberId && !team.members.some(member => member.memberId === input.ownerMemberId && !member.stoppedByUser)) throw new Error("Task owner is not available");
      const dependencies = [...new Set(input.dependencies ?? [])];
      if (dependencies.some(id => !team.tasks.some(task => task.id === id))) throw new Error("Task dependency is not available");
      const now = this.now(); team.tasks.push({ id: randomUUID(), title: input.title.trim(), description: input.description ?? "",
        ownerMemberId: input.ownerMemberId ?? null, dependencies, status: "todo", version: 1, createdAt: now, updatedAt: now });
    });
    this.changed(input.teamId); return this.require(input.teamId);
  }
  async updateTask(input: { teamId: string; taskId: string; expectedVersion: number; status?: PluginTeamTask["status"]; ownerMemberId?: string | null; dependencies?: string[] }) {
    this.requireActive(input.teamId);
    await this.store.update(input.teamId, team => {
      const task = team.tasks.find(value => value.id === input.taskId);
      if (!task) throw new Error("Task is not available");
      if (task.mergeOperationId) throw new Error("This task has a pending worktree merge; finish or recover that operation first");
      if (task.version !== input.expectedVersion) throw new Error("Stale task version; reload the task board");
      if (input.ownerMemberId && !team.members.some(member => member.memberId === input.ownerMemberId && !member.stoppedByUser)) throw new Error("Task owner is not available");
      const dependencies = input.dependencies ? [...new Set(input.dependencies)] : task.dependencies;
      if (dependencies.some(id => id === task.id || !team.tasks.some(value => value.id === id))) throw new Error("Invalid task dependency");
      const reaches = (id: string, seen = new Set<string>()): boolean => {
        if (id === task.id) return true; if (seen.has(id)) return false; seen.add(id);
        return team.tasks.find(value => value.id === id)?.dependencies.some(next => reaches(next, seen)) ?? false;
      };
      if (dependencies.some(id => reaches(id))) throw new Error("Task dependency cycle");
      if (["in-progress", "done"].includes(input.status ?? "") && dependencies.some(id => team.tasks.find(value => value.id === id)?.status !== "done")) throw new Error("Task dependencies are not complete");
      if (input.status && !["done", "cancelled"].includes(input.status) && ["done", "cancelled"].includes(task.status) &&
        team.tasks.filter(value => !["done", "cancelled"].includes(value.status)).length >= 256) throw new Error("A team supports at most 256 active tasks");
      if (input.status) task.status = input.status;
      if (input.ownerMemberId !== undefined) task.ownerMemberId = input.ownerMemberId;
      task.dependencies = dependencies; task.version++; task.updatedAt = this.now();
    });
    this.changed(input.teamId); await this.releaseIdleGroup(input.teamId); return this.require(input.teamId);
  }
  async reserveTaskMerge(input: { teamId: string; taskId: string; memberId: string; expectedVersion: number; operationId: string }) {
    this.requireActive(input.teamId);
    const version = await this.store.update(input.teamId, team => {
      const task = team.tasks.find(value => value.id === input.taskId), member = team.members.find(value => value.memberId === input.memberId);
      if (!task || !member || task.ownerMemberId !== member.memberId || member.isolation !== "worktree") throw new Error("Task does not belong to this isolated member");
      if (task.mergeOperationId === input.operationId) return task.version;
      if (task.mergeOperationId || task.version !== input.expectedVersion) throw new Error("Stale task merge version");
      if (["running", "stopping"].includes(member.status)) throw new Error("Stop the isolated writer before merging its result");
      task.mergeOperationId = input.operationId; task.version++; task.updatedAt = this.now(); return task.version;
    });
    this.changed(input.teamId); return version;
  }
  assertTaskMerge(input: { teamId: string; taskId: string; operationId: string; version: number }) {
    const team = this.requireActive(input.teamId), task = team.tasks.find(value => value.id === input.taskId);
    if (!task || task.mergeOperationId !== input.operationId || task.version !== input.version) throw new Error("Task changed before merge publication");
  }
  async finishTaskMerge(input: { teamId: string; taskId: string; operationId: string; conflicted: boolean }) {
    await this.store.update(input.teamId, team => {
      const task = team.tasks.find(value => value.id === input.taskId);
      if (!task || task.mergeOperationId !== input.operationId) throw new Error("Task merge ownership changed");
      delete task.mergeOperationId; task.version++; task.updatedAt = this.now(); if (input.conflicted) task.status = "blocked";
    });
    this.changed(input.teamId);
  }
  async stopMember(input: { teamId: string; memberId: string }) {
    const team = this.require(input.teamId), member = team.members.find(value => value.memberId === input.memberId);
    if (!member) throw new Error("Team member is not available");
    await this.store.update(team.id, current => {
      const value = current.members.find(item => item.memberId === input.memberId)!; value.stoppedByUser = true; value.status = "stopping";
      for (const message of current.messages) if (message.targetChatId === value.chatId && ["queued", "unknown"].includes(message.status)) message.status = "cancelled";
    });
    this.changed(team.id);
    try {
      await this.options.sessions.stop({ chatId: member.chatId, incarnation: member.incarnation });
      await this.store.update(team.id, current => {
        const value = current.members.find(item => item.memberId === input.memberId)!; value.status = "stopped"; delete value.activeRequestId;
        this.releaseTasks(current, value.memberId);
        if (!current.members.some(item => item.status === "stopping" || item.status === "failed")) delete current.error;
      });
    } catch (cause) {
      const status = await this.options.sessions.status({ chatId: member.chatId, incarnation: member.incarnation }).catch(() => "stopping" as const);
      await this.store.update(team.id, current => { current.error = String(cause).slice(0, 2048); current.members.find(item => item.memberId === input.memberId)!.status = status === "failed" ? "failed" : "stopping"; });
      this.changed(team.id); throw cause;
    }
    this.changed(team.id); await this.releaseIdleGroup(team.id); return this.require(team.id);
  }
  async stop(teamId: string) {
    this.require(teamId); this.groupControllers.get(teamId)?.abort(new Error("Team stopped"));
    await this.store.update(teamId, current => { current.status = "stopping"; delete current.error; });
    const members = this.require(teamId).members.filter(member => member.status !== "stopped" || member.activeRequestId);
    const results = await Promise.allSettled(members.map(member => this.stopMember({ teamId, memberId: member.memberId })));
    await Promise.allSettled(this.pendingMembers(teamId));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    await this.store.update(teamId, current => { current.status = errors.length ? "failed" : "stopped"; });
    if (!errors.length) await this.releaseIdleGroup(teamId);
    this.changed(teamId);
    if (errors.length) throw new AggregateError(errors, "Team processes have not all stopped");
    return this.require(teamId);
  }
  private needsStop(team: PluginTeamSnapshot) {
    return team.status !== "stopped" || this.groupHolds.has(team.id) || this.pendingMembers(team.id).length > 0 ||
      team.members.some(member => member.status === "running" || member.status === "stopping" || member.activeRequestId);
  }
  async stopPlugin(pluginId: string) { for (const team of this.list().filter(value => value.pluginId === pluginId && this.needsStop(value))) await this.stop(team.id); }
  async stopLead(leadChatId: string) { for (const team of this.list({ leadChatId }).filter(value => this.needsStop(value))) await this.stop(team.id); }
  async prepared(chatId: string, requestId: string) {
    const team = this.teamForChat(chatId), member = team?.members.find(value => value.chatId === chatId);
    if (!team || !member || !await this.options.sessions.prepared?.({ chatId, requestId })) return;
    await this.store.update(team.id, current => { current.members.find(value => value.chatId === chatId)!.activeRequestId = requestId; });
  }
  async settled(chatId: string, outcome?: PluginMemberTurnOutcome) {
    const team = this.teamForChat(chatId);
    if (!team) return;
    const member = team.members.find(value => value.chatId === chatId);
    if (member && outcome && this.options.sessions.settled) {
      const receipt = await this.options.sessions.settled({ chatId, ...outcome });
      if (receipt === "stale") return;
      if (receipt === "duplicate" && !["running", "stopping"].includes(member.status)) { await this.releaseIdleGroup(team.id); return; }
    }
    await this.reconcile(team.id);
    if (member && outcome && outcome.cleanup !== "complete") await this.store.update(team.id, current => {
      current.error = "Waiting for member cleanup: " + member.name;
      for (const task of current.tasks.filter(value => value.ownerMemberId === member.memberId && !["done", "cancelled", "blocked"].includes(value.status))) {
        task.status = "blocked"; task.version++; task.updatedAt = this.now();
      }
    });
    const current = this.require(team.id);
    if (current.error?.startsWith("Waiting for member cleanup:") && !current.members.some(value => value.status === "stopping"))
      await this.store.update(team.id, value => { delete value.error; });
    if (this.require(team.id).status === "active") await this.delivery.flush(team.id);
    await this.releaseIdleGroup(team.id);
  }
  async reconcile(teamId: string) {
    const team = this.require(teamId);
    for (const member of team.members) {
      let status: PluginMemberSession["status"];
      try { status = await this.options.sessions.status({ chatId: member.chatId, incarnation: member.incarnation }); }
      catch { status = "stopping"; }
      await this.store.update(teamId, current => {
        const value = current.members.find(item => item.memberId === member.memberId)!;
        const previous = value.status;
        value.status = value.stoppedByUser && status === "idle" ? "stopped" : status;
        if (status === "stopping") {
          current.error ??= "Waiting for member cleanup: " + value.name;
          for (const task of current.tasks.filter(task => task.ownerMemberId === value.memberId && !["done", "cancelled", "blocked"].includes(task.status))) {
            task.status = "blocked"; task.version++; task.updatedAt = this.now();
          }
        }
        if (status !== "running" && status !== "stopping") {
          if ((status === "failed" || status === "stopped") && (previous !== status || value.activeRequestId)) this.releaseTasks(current, value.memberId);
          delete value.activeRequestId;
        }
        if (current.error?.startsWith("Waiting for member cleanup:") && !current.members.some(member => member.status === "stopping")) delete current.error;
      });
    }
    this.changed(teamId);
  }
  openMember(input: { teamId: string; memberId: string }) {
    const team = this.require(input.teamId), member = team.members.find(value => value.memberId === input.memberId);
    if (!member) throw new Error("Team member is not available");
    return { chatId: member.chatId, incarnation: member.incarnation, projectId: team.projectId };
  }
  private releaseTasks(team: PluginTeamSnapshot, memberId: string) {
    for (const task of team.tasks) if (task.ownerMemberId === memberId && !["done", "cancelled"].includes(task.status)) {
      task.ownerMemberId = null; task.status = "blocked"; task.version++; task.updatedAt = this.now();
    }
  }
  private pendingMembers(teamId: string) { return [...this.adding].filter(([key]) => key.startsWith(teamId + ":")).map(([, value]) => value); }
  private groupBusy(teamId: string) {
    const team = this.require(teamId);
    return this.pendingMembers(teamId).length > 0 || team.members.some(member => member.status === "running" || member.status === "stopping") ||
      team.status === "active" && team.tasks.some(task => task.status === "in-progress");
  }
  private async retainGroup(team: PluginTeamSnapshot) {
    await this.groupReleases.get(team.id); this.assertOpen();
    if (this.groupHolds.has(team.id) || !this.options.retainGroup) return;
    const previous = this.groupAcquisitions.get(team.id); if (previous) return previous;
    const acquisition = (async () => {
      const controller = this.groupControllers.get(team.id) ?? new AbortController(); this.groupControllers.set(team.id, controller);
      const hold = await this.options.retainGroup!({ teamId: team.id, projectId: team.projectId,
        owner: teamExecutionOwner(team.pluginId, team.leadChatId, team.leadIncarnation), signal: controller.signal });
      if (hold) {
        if (this.closed) { await hold.release(); this.assertOpen(); }
        this.groupHolds.set(team.id, hold);
      }
    })();
    this.groupAcquisitions.set(team.id, acquisition);
    try { await acquisition; } finally { if (this.groupAcquisitions.get(team.id) === acquisition) this.groupAcquisitions.delete(team.id); }
  }
  private releaseIdleGroup(teamId: string) { return this.releaseGroup(teamId); }
  private async releaseGroup(teamId: string, force = false): Promise<void> {
    const previous = this.groupReleases.get(teamId);
    if (previous) { await previous; if (force) await this.releaseGroup(teamId, true); return; }
    const hold = this.groupHolds.get(teamId);
    if (!hold || !force && this.groupBusy(teamId)) return;
    // Publish the barrier before release begins; new creators must never inherit a disappearing hold.
    const release = Promise.resolve().then(async () => {
      if (this.groupHolds.get(teamId) !== hold || !force && this.groupBusy(teamId)) return;
      await hold.release();
      if (this.groupHolds.get(teamId) === hold) this.groupHolds.delete(teamId);
    }).finally(() => { if (this.groupReleases.get(teamId) === release) this.groupReleases.delete(teamId); });
    this.groupReleases.set(teamId, release); await release;
  }
  private require(teamId: string) { const team = this.get(teamId); if (!team) throw new Error("Team is not available"); return team; }
  private requireActive(teamId: string) { const team = this.require(teamId); if (team.status !== "active") throw new Error("Team is stopped"); return team; }
  private assertOpen() { if (this.closed) throw new Error("Team service is closing"); }
  private changed(teamId: string) { const team = this.get(teamId); if (team) for (const listener of this.listeners) listener({ teamId, revision: team.revision }); }
  async close() {
    if (this.closed) return; this.closed = true;
    for (const controller of this.groupControllers.values()) controller.abort(new Error("Team service is closing"));
    await this.delivery.close(); await Promise.allSettled([...this.adding.values(), ...this.resuming.values()]);
    const errors: unknown[] = [];
    for (const team of this.list()) for (const member of team.members.filter(value => value.status !== "stopped")) {
      try { await this.options.sessions.stop({ chatId: member.chatId, incarnation: member.incarnation, reason: "shutdown" }); }
      catch (cause) { errors.push(cause); }
    }
    if (!errors.length) for (const teamId of [...this.groupHolds.keys()]) await this.releaseGroup(teamId, true);
    this.groupHolds.clear(); await this.store.close(); this.listeners.clear();
    if (errors.length) throw new AggregateError(errors, "Team shutdown cleanup remains incomplete");
  }
}
export async function createPluginTeamService(options: PluginTeamServiceOptions) {
  const service = new PluginTeamService(options); await service.initialize(); return service;
}
