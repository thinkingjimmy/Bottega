/**
 * [INPUT]: Lean installed-team registry, canonical public Provider IDs/backend schema, existing Coordinator, canonical Chats/Projects, trusted plugin RPC and shared authoring leases.
 * [OUTPUT]: Production persistent team sessions, official source installation, exact active-Lead/Project recovery, feature RPC, native panel registrar and cleanup.
 * [POS]: Team plugin composition; root startup installs this owner before any window lists member Chats.
 */
import { z } from "zod";
import type { BrowserWindow } from "electron";
import type { AgentBackendId, AgentTurnOptions } from "../../../../shared/ipc/agent/agent-ipc";
import { backendDefaults } from "../../../../shared/chat-agent/options";
import { agentBackendIdSchema } from "../../../../shared/platform/agent-schema";
import { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { pluginIdentitySchema as id } from "@bottega/contracts/plugins/platform";
import type { PluginTeamSnapshot } from "@bottega/contracts/plugins/team";
import { turns } from "../../agent/bridge/agent-bridge";
import { installNativeMemberForkResolver } from "../../library/sessions/member-fork";
import type { ChatStore } from "../../chats/chat-store";
import type { ChatsService } from "../../chats/service/chats-service";
import { installMemberChatIndex } from "../../chats/projection/chat-summary";
import type { ProjectsService } from "../../projects/projects-service";
import type { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { UnifiedPluginPlatform } from "../platform/service";
import type { PluginAuthoringLeases } from "../engineering/leases";
import type { PluginHostRpcBroker, PluginRpcContext } from "../process/rpc";
import { createPersistentMemberSessions } from "./sessions";
import { createPluginTeamService } from "./service";
import { installPluginTeamService } from "./runtime/installed";
import { ensureTeamPluginSource, prepareTeamPluginRevision } from "./seed";
import { openPluginWorktreeMerges } from "./isolation/merge";
import { runGit } from "../../projects/git/git-runner";
import { registerPluginTeams } from "./ipc";

export type PluginTeamsInput = Readonly<{
  userData: string; coordinator: ConversationCoordinator; chats: ChatStore; chatsService: ChatsService;
  projects: ProjectsService; rpc: PluginHostRpcBroker; platform: UnifiedPluginPlatform; authoringLeases: PluginAuthoringLeases;
  rebuild(pluginId: string): Promise<unknown>;
  turnOptionsFor?(backend: AgentBackendId): AgentTurnOptions;
}>;
export async function initializePluginTeams(input: PluginTeamsInput) {
  const workspaceFor = (projectId: string) => {
    const project = input.projects.store.get(projectId);
    if (!project || project.archivedAt || project.workspaceBinding.kind === "none" || project.workspaceBinding.kind === "unbound") return null;
    try { input.projects.resolveCodexContext(projectId); } catch { return null; }
    return { kind: "project" as const, projectId, membershipRevision: project.membershipRevision };
  };
  const waitForCleanup = async (requestId: string) => {
    const deadline = Date.now() + 30_000;
    while (true) {
      const entry = turns.byRequest(requestId);
      if (!entry || entry.cleanup === "complete") return;
      if (entry.cleanup === "failed") throw new Error("Member process cleanup failed");
      if (entry.cleanupInFlight) { await entry.cleanupInFlight; continue; }
      if (Date.now() >= deadline) throw new Error("Member process cleanup did not finish");
      await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
  };
  const sessions = await createPersistentMemberSessions({
    userData: input.userData, submit: submission => input.coordinator.submitManualTurn(submission),
    cancel: requestId => input.coordinator.cancelManualTurn(requestId), cancelPending: chatId => input.coordinator.cancelMemberTurns(chatId),
    waitForCleanup, incarnationOf: chatId => input.chats.getIncarnationId(chatId) ?? null,
    chatFacts: chatId => input.chats.getMetadata(chatId) ?? null, workspaceFor,
    turnOptionsFor: input.turnOptionsFor ?? (backend => backendDefaults({}, backend)),
    currentRequest: chatId => turns.hasActivity([chatId]) ? turns.byConversation(chatId) ?? null : null,
    steer: value => input.coordinator.steer(value),
    forkChat: async value => {
      const source = await input.chats.getConversation(value.sourceChatId);
      if (!source || source.projectId !== value.projectId || source.readOnlyReason) throw new Error("Member fork source is not an editable Chat in this Project");
      const anchor = [...source.messages].reverse().find(message => message.role === "assistant" && !message.isError && !message.failure &&
        (message.content.trim() || message.parts?.length));
      if (!anchor) throw new Error("Member fork requires a completed assistant message");
      const latest = source.messages.filter(message => message.role !== "notice").at(-1);
      const nativeFork = (value.providerId === BUILTIN_PROVIDER_IDS.codex || value.providerId === BUILTIN_PROVIDER_IDS.claude) && source.agent === value.providerId &&
        source.session?.backend === value.providerId && !turns.hasActivity([source.id]) && latest?.id === anchor.id && source.chatMessageRevision !== undefined
        ? { backend: value.providerId, sourceChatId: source.id, sourceIncarnation: source.incarnationId,
          sourceMessageRevision: source.chatMessageRevision, sourceSessionId: source.session.id } : undefined;
      await input.chatsService.forkChat({ requestId: "member_fork_" + hashCanonical([value.targetChatId, source.id, source.incarnationId]),
        sourceChatId: source.id, sourceIncarnationId: source.incarnationId, anchorMessageId: anchor.id, anchorSeq: anchor.seq,
        childChatId: value.targetChatId, mode: value.isolation === "worktree" ? "new-worktree" : "same-workspace" }, {
          initialMode: { id: "team", pluginId: value.pluginId, name: "Team" }, memberSession: value.memberSession,
          validate: async () => { if (!workspaceFor(value.projectId) || !input.platform.isActive(value.pluginId)) throw new Error("Member fork authority is unavailable"); },
          current: () => { const current = input.chats.getMetadata(source.id);
            if (current?.incarnationId !== source.incarnationId || current.projectId !== value.projectId || current.readOnlyReason)
              throw new Error("Member fork source identity changed"); },
        });
      return { nativeFork };
    },
  });
  installMemberChatIndex(sessions);
  installNativeMemberForkResolver(value => sessions.nativeForkFor(value));
  let deliveryRegistered = false;
  const service = await createPluginTeamService({
    canDeliver: team => { const lead = input.chats.getMetadata(team.leadChatId);
      return deliveryRegistered && input.platform.isActive(team.pluginId) && Boolean(workspaceFor(team.projectId)) &&
        lead?.incarnationId === team.leadIncarnation && lead.projectId === team.projectId && !lead.readOnlyReason; },
    userData: input.userData, sessions, projectReady: projectId => Boolean(workspaceFor(projectId)),
    leadSession: team => {
      const metadata = input.chats.getMetadata(team.leadChatId);
      if (!metadata || metadata.incarnationId !== team.leadIncarnation || metadata.projectId !== team.projectId) return null;
      return { pluginId: team.pluginId, leadChatId: team.leadChatId, leadIncarnation: team.leadIncarnation, projectId: team.projectId,
        chatId: team.leadChatId, incarnation: team.leadIncarnation, memberId: "lead", name: "Lead", providerId: metadata.agent,
        status: turns.hasActivity([team.leadChatId]) ? "running" : "idle", createdAt: metadata.createdAt };
    },
    retainGroup: async value => {
      const source = input.platform.store.read(state => state.plugins.find(plugin => plugin.sourceProject?.projectId === value.projectId)?.directory.sourceDirectory);
      return source ? input.authoringLeases.acquire(source, value.owner, "team-controller", value.signal) : null;
    },
  });
  installPluginTeamService(service);
  const merges = await openPluginWorktreeMerges({ userData: input.userData });
  const releases: (() => void)[] = [];
  const caller = (context: PluginRpcContext) => {
    const lease = context.invocation?.lease;
    if (!lease || input.chats.getIncarnationId(lease.chatId) !== lease.incarnationId) throw new Error("Team operation requires a current host-issued Chat invocation");
    return lease;
  };
  const teamForCaller = (context: PluginRpcContext, leadOnly = false): PluginTeamSnapshot => {
    const lease = caller(context);
    const team = service.list().find(team => team.pluginId === context.pluginId &&
      ((team.leadChatId === lease.chatId && team.leadIncarnation === lease.incarnationId) ||
        !leadOnly && team.members.some(member => member.chatId === lease.chatId && member.incarnation === lease.incarnationId)));
    if (!team) throw new Error("Create a team in this Project before using team operations");
    if (input.chats.getProjectId(lease.chatId) !== team.projectId) throw new Error("Team Chat Project identity changed");
    return team;
  };
  const register = (name: string, handler: (raw: unknown, context: PluginRpcContext) => Promise<unknown> | unknown) => releases.push(input.rpc.register("team." + name, handler));
  register("create", (_raw, context) => {
    const lease = caller(context), projectId = input.chats.getProjectId(lease.chatId);
    if (!projectId) throw new Error("Team mode requires a Project");
    return service.create({ pluginId: context.pluginId, leadChatId: lease.chatId, leadIncarnation: lease.incarnationId, projectId });
  });
  register("add-member", (raw, context) => service.addMember({ ...z.object({ memberId: id.optional(), name: z.string().min(1).max(160),
    providerId: agentBackendIdSchema, task: z.string().min(1).max(32_768), forkChatId: id.optional(),
    isolation: z.enum(["shared", "worktree"]).optional() }).strict().parse(raw), teamId: teamForCaller(context, true).id }));
  register("send", (raw, context) => {
    const value = z.object({ memberId: id, body: z.string().min(1).max(32_768), messageId: id.optional() }).strict().parse(raw);
    return service.send({ teamId: teamForCaller(context).id, id: value.messageId ?? context.invocation!.invocationId,
      senderChatId: caller(context).chatId, memberId: value.memberId, body: value.body });
  });
  register("inbox", (_raw, context) => {
    const lease = caller(context); return service.inbox({ teamId: teamForCaller(context).id, memberChatId: lease.chatId, incarnation: lease.incarnationId });
  });
  register("ack", (raw, context) => {
    const lease = caller(context); return service.acknowledge({ ...z.object({ ids: z.array(id).min(1).max(256), consumptionId: id }).strict().parse(raw),
      teamId: teamForCaller(context).id, memberChatId: lease.chatId, incarnation: lease.incarnationId });
  });
  register("create-task", (raw, context) => service.createTask({ ...z.object({ title: z.string().min(1).max(300), description: z.string().max(16_384).optional(),
    ownerMemberId: id.nullable().optional(), dependencies: z.array(id).max(256).optional() }).strict().parse(raw), teamId: teamForCaller(context).id }));
  register("update-task", (raw, context) => service.updateTask({ ...z.object({ taskId: id, expectedVersion: z.number().int().positive(),
    status: z.enum(["todo", "in-progress", "blocked", "done", "cancelled"]).optional(), ownerMemberId: id.nullable().optional(),
    dependencies: z.array(id).max(256).optional() }).strict().parse(raw), teamId: teamForCaller(context).id }));
  register("stop-member", (raw, context) => service.stopMember({ ...z.object({ memberId: id }).strict().parse(raw), teamId: teamForCaller(context, true).id }));
  register("stop", (_raw, context) => service.stop(teamForCaller(context, true).id));
  register("worktree-status", async (raw, context) => {
    const { memberId } = z.object({ memberId: id }).strict().parse(raw), team = teamForCaller(context), member = team.members.find(value => value.memberId === memberId);
    const metadata = member && input.chats.getMetadata(member.chatId);
    if (!member || member.isolation !== "worktree" || !metadata?.executionDir) throw new Error("Member has no managed isolated worktree");
    const source = input.projects.resolveCodexContext(team.projectId).workspace;
    return { expectedHead: (await runGit(source, ["rev-parse", "HEAD"])).trim(), memberCommit: (await runGit(metadata.executionDir, ["rev-parse", "HEAD"])).trim(),
      dirty: Boolean((await runGit(metadata.executionDir, ["status", "--porcelain=v1", "--untracked-files=all"])).trim()), receipts: merges.list({ kind: "team", id: team.id }) };
  });
  register("merge-member", async (raw, context) => {
    const value = z.object({ memberId: id, taskId: id, expectedVersion: z.number().int().positive(), expectedHead: z.string().regex(/^[a-f0-9]{40,64}$/),
      operationId: id.optional(), message: z.string().min(1).max(200).optional() }).strict().parse(raw);
    const team = teamForCaller(context, true), member = team.members.find(item => item.memberId === value.memberId);
    const metadata = member && input.chats.getMetadata(member.chatId), operationId = value.operationId ?? context.invocation!.invocationId;
    if (!member || member.isolation !== "worktree" || metadata?.executionKind !== "managed-worktree" || !metadata.executionDir) throw new Error("Member has no managed isolated worktree");
    if (turns.hasActivity([member.chatId])) throw new Error("Wait for the isolated member to finish before merging");
    context.signal.throwIfAborted();
    const version = await service.reserveTaskMerge({ teamId: team.id, taskId: value.taskId, memberId: member.memberId, expectedVersion: value.expectedVersion, operationId });
    await input.chatsService.commitManagedWorktree({ chatId: member.chatId, incarnationId: member.incarnation, message: value.message ?? "Commit isolated team result" });
    const source = input.projects.resolveCodexContext(team.projectId).workspace, memberCommit = (await runGit(metadata.executionDir, ["rev-parse", "HEAD"])).trim();
    const result = await merges.merge({ operationId, owner: { kind: "team", id: team.id }, sourceWorkspace: source,
      memberWorktree: metadata.executionDir, expectedHead: value.expectedHead, memberCommit, message: value.message ?? "Merge isolated team result" }, () => {
        context.signal.throwIfAborted(); service.assertTaskMerge({ teamId: team.id, taskId: value.taskId, operationId, version });
      });
    await service.finishTaskMerge({ teamId: team.id, taskId: value.taskId, operationId, conflicted: result.status === "conflicted" });
    return result;
  });
  register("state", (_raw, context) => ({ teams: context.invocation ? [teamForCaller(context)] : service.list().filter(team => team.pluginId === context.pluginId) }));
  const releaseChats = input.chatsService.onEvent(event => {
    if (event.type === "removed" || event.type === "upserted" && (event.summary.archivedAt ||
      service.list({ leadChatId: event.summary.id }).some(team => team.projectId !== event.summary.projectId || team.leadIncarnation !== event.summary.incarnationId))) {
      const chatId = event.type === "removed" ? event.chatId : event.summary.id;
      void service.stopLead(chatId).catch(error => console.warn("[teams] Lead cleanup failed", error));
    }
  });
  releases.push(releaseChats);
  releases.push(input.projects.store.onArchivedChange(projectId => {
    const project = input.projects.store.get(projectId);
    if (!project || project.archivedAt) for (const team of service.list().filter(team => team.projectId === projectId))
      void service.stop(team.id).catch(error => console.warn("[teams] Project cleanup failed", error));
  }));
  releases.push(input.platform.onBeforeDisable(pluginId => service.stopPlugin(pluginId)));
  const source = await ensureTeamPluginSource(input.userData);
  await input.platform.register({ ...source, replace: true });
  await prepareTeamPluginRevision({ platform: input.platform, rebuild: input.rebuild,
    reportError: error => console.warn("[teams] Initial plugin revision remains unavailable", error) });
  deliveryRegistered = true;
  const resume = () => { void service.resume().catch(error => console.warn("[teams] Member recovery failed", error)); };
  releases.push(input.platform.onChanged(resume)); resume();
  return {
    service, sessions, authoringOwnerForChat: (chatId: string) => service.authoringOwnerForChat(chatId),
    registrar: { register: (window: BrowserWindow, rendererUrl: string) => registerPluginTeams(service, window, rendererUrl) },
    settled: (chatId: string, outcome?: import("./service").PluginMemberTurnOutcome) => service.settled(chatId, outcome),
    async close() {
      releases.forEach(release => release()); await service.close(); await merges.close(); await sessions.close();
      installPluginTeamService(null); installMemberChatIndex(null); installNativeMemberForkResolver(null);
    },
  };
}
export type PluginTeamsRuntime = Awaited<ReturnType<typeof initializePluginTeams>>;
