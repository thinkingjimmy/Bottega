/**
 * [INPUT]: Depends on original strict manual validation, exact installed facts, Project ownership and committed ledger evidence.
 * [OUTPUT]: Maps closed remote inputs, capability-checked next-turn options (including a persisted model, effort and service-tier choice) and scoped Full Access into one immutable native submission. mapRemoteFirstMessage (U06 Q7-c): a reservation's first message as the create-app of its App's first Edit Chat.
 * [POS]: apps/desktop/electron/main/cloud/remote/commands/dispatch; Intake mapping inside the original Workspace/conversation gate; it performs no network calls or Agent launch.
 */
import { builtinAgent, builtinOptions } from "../../../../../../shared/chat-agent/options";
import type { RemoteWorkspaceService } from "../input/references";
import { projectRichInput, richInputDisplayText } from "../../../../../../shared/content/rich/rich-input-projection";
import { isRemoteTurnPayload, REMOTE_EXECUTABLE_KINDS } from "@ai-chat/cloud-protocol/remote/model";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import type { RemoteCommand, RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { WorkspacePrecondition, SubmissionContentV1 } from "../../../../../../shared/content/submission/submission";
import type { AgentBackendId, AgentTurnOptions } from "../../../../../../shared/ipc/agent/agent-ipc";
import type { ChatFacts } from "../../../../chats/projection/chat-summary";
import type { ChatStore } from "../../../../chats/chat-store";
import type { ProjectStore } from "../../../../projects/store/project-store";
import type { RelayLedger } from "../../../../sections/coordinator/relay-ledger";
import type { PreparedManualTurn } from "../../../../sections/coordinator/admission/prepared-manual-turn";
import { stableId } from "../../../../sections/coordinator/coordinator-values";
import { validateManualTurnSubmission } from "../../../../agent/validation";
import type { TrustedManualTurnSubmission } from "../../../../../../shared/ipc/content/sections-ipc";
import type { RemoteContext } from "../../../../sections/coordinator/remote/model";
import { backendById, backendRuntimeRegistry } from "../../../../backends";
import { remoteConsentMatches } from "@ai-chat/cloud-protocol/remote/input/model";
type Ports = { references?: RemoteWorkspaceService | null; store: ChatStore; projects: Pick<ProjectStore, "get">; ledger: RelayLedger;
  remoteInput?: TrustedManualTurnSubmission["remoteInput"];
  defaults(backend: AgentBackendId): AgentTurnOptions; projectAvailable(projectId: string): boolean; current(): void;
  /** Broadcasts a persisted options change to product windows; sync already learns it from the store. */
  publishRecord?(record: Awaited<ReturnType<ChatStore["patchOptions"]>>): void };
export function remoteText(text: string, id: string): SubmissionContentV1 {
  return { schemaVersion: 1, origin: "composer", capabilityEpoch: 0, backendEpoch: 0,
    content: { richValue: [{ id: stableId("text", id), type: "text", value: text }], displayText: text, files: [] } };
}
/* U06-b: a remote turn runs in an ordinary Chat or an App's Use / Edit Chat, by the same rules, from the one list the server reads too. */
export const remoteExecutableContext = (context: ChatFacts["context"]) => REMOTE_EXECUTABLE_KINDS.has(context.kind);
/**
 * The local half of a remote command's execution authority: its Chat still takes remote work here. A reservation's first message acts
 * before its Chat exists (U06 Q7-c), which the ledger admitted only as that App Edit Chat's own create-app (§8.4.3).
 */
export function assertRemoteChatCurrent(store: Pick<ChatStore, "getMetadata">, ledger: Pick<RelayLedger, "remote">, context: RemoteContext) {
  const facts = store.getMetadata(context.chatId);
  if (!facts && ledger.remote.lookup(context)?.submission.persistence.kind === "create-app") return;
  if (!facts || facts.incarnationId !== context.incarnationId || !remoteExecutableContext(facts.context) || facts.archivedAt || facts.readOnlyReason) throw new Error("chat-not-executable");
}
export function remoteWorkspace(facts: Pick<ChatFacts, "id" | "incarnationId" | "projectId" | "context">, ports: Pick<Ports, "projects" | "projectAvailable">): WorkspacePrecondition {
  if (!facts.projectId) return { kind: "chat-home", conversationId: facts.id, incarnationId: facts.incarnationId };
  const project = ports.projects.get(facts.projectId);
  if (!project || project.archivedAt || !ports.projectAvailable(facts.projectId)) throw new Error("project-unavailable");
  const binding = project.workspaceBinding;
  if (binding.kind === "none") throw new Error("project-path-unbound");
  // An App's own Project runs only that App's Use and Edit Chats.
  const ownApp = binding.kind === "app" && facts.context.kind !== "ordinary" && binding.appId === facts.context.appId;
  if (binding.kind !== "external" && !ownApp) throw new Error("chat-not-executable");
  return { kind: "project", projectId: facts.projectId, membershipRevision: project.membershipRevision };
}
/* Only what differs from the options the turn would otherwise use: an identical choice is not a change to persist. */
export function remoteModelPatch(choice: RemoteTurnOptions | undefined, current: AgentTurnOptions) {
  if (!choice) return null;
  const patch: RemoteTurnOptions = {};
  if (choice.model !== undefined && choice.model !== ("model" in current ? current.model : undefined)) patch.model = choice.model;
  if (choice.reasoningEffort !== undefined && choice.reasoningEffort !== ("reasoningEffort" in current ? current.reasoningEffort : undefined)) patch.reasoningEffort = choice.reasoningEffort;
  if (choice.serviceTier !== undefined && choice.serviceTier !== ("serviceTier" in current ? current.serviceTier : undefined)) patch.serviceTier = choice.serviceTier;
  return Object.keys(patch).length ? patch : null;
}
export function committedPlanMode(ledger: RelayLedger, facts: Pick<ChatFacts, "id" | "incarnationId" | "agent" | "agentRevision">) {
  const state = ledger.snapshot();
  const intents = Object.values(state.manualIntents).filter(intent => intent.conversationId === facts.id &&
    state.submissionOutcomes[intent.id]?.custody === "chat-persisted").sort((a, b) => (b.userSeq ?? 0) - (a.userSeq ?? 0));
  const prepared = intents[0]?.payload as PreparedManualTurn | undefined;
  return Boolean(prepared && prepared.precondition.kind === "existing" && prepared.precondition.incarnationId === facts.incarnationId &&
    prepared.turn.turnOptions.backend === facts.agent && (prepared.expectedAgentRevision ?? facts.agentRevision) === facts.agentRevision && prepared.turn.planMode);
}
export async function mapRemoteSubmission(command: RemoteCommand, head: CloudChatHead, scope: SyncScope, ports: Ports) {
  if (!isRemoteTurnPayload(command.payload)) throw new Error("admission-failed");
  ports.current();
  const local = await ports.store.sync.read(scope, { type: "remote-admission", chatId: command.chatId }); ports.current();
  if (local.type !== "remote-admission" || !local.value?.execution) throw new Error("execution-not-ready");
  const { facts, execution, pending } = local.value, payload = command.payload, installed = execution.head;
  if (facts.incarnationId !== command.incarnationId || installed.chat.incarnationId !== command.incarnationId) throw new Error("chat-incarnation-mismatch");
  if (head.ownerDeviceId !== command.targetDeviceId || installed.ownerDeviceId !== command.targetDeviceId) throw new Error("not-owner");
  if (head.kind === "external-readonly" || facts.readOnlyReason || !remoteExecutableContext(facts.context) || head.archivedAt !== null || facts.archivedAt || execution.deleted) throw new Error("chat-not-executable");
  if (head.executionPreparation && head.executionPreparation.state !== "ready") throw new Error("execution-not-ready");
  if (command.intent && head.chat.agent !== command.intent.baselineAgent && head.chat.agent !== payload.agentSelection?.backend) throw new Error("agent-changed");
  if (head.chat.agentRevision !== payload.expectedAgentRevision || installed.chat.agentRevision !== payload.expectedAgentRevision ||
    facts.agentRevision !== payload.expectedAgentRevision) throw new Error("agent-revision-changed");
  if (payload.agentSelection && (head.catalogRevision !== payload.agentSelection.expectedFactRevision || installed.catalogRevision !== payload.agentSelection.expectedFactRevision)) throw new Error("fact-revision-changed");
  if (installed.catalogRevision !== head.catalogRevision || installed.chat.agent !== head.chat.agent) throw new Error("fact-revision-changed");
  if (pending || facts.agent !== head.chat.agent || canonicalJson(facts.options) !== canonicalJson(head.chat.options) ||
    facts.title !== head.chat.title || facts.projectId !== head.chat.classification.projectId) throw new Error("local-facts-pending");
  /* A remote command reaches only an enrolled Chat, and a package Provider's Chat never enrolls (TASK-11 S3-b): narrow, never cast. */
  const agent = builtinAgent(facts.agent), saved = builtinOptions(facts.options);
  if (!agent || !saved) throw new Error("agent-unavailable");
  const backend = payload.agentSelection?.backend ?? agent, switching = backend !== agent;
  let options = switching ? ports.defaults(backend) : structuredClone(saved);
  if (payload.permissionMode) options.permissionMode = payload.permissionMode;
  const planMode = payload.planMode ?? (switching ? false : committedPlanMode(ports.ledger, facts));
  // The choice came from this owner's published catalog, so the backend's own option validation is the only gate it needs.
  const chosen = remoteModelPatch(payload.options, options);
  if (chosen) { options = { ...options, ...chosen } as AgentTurnOptions; backendById(backend).validateTurnOptions(options); }
  if (payload.permissionMode || payload.planMode !== undefined || payload.attachments?.length) {
    const runtime = await backendRuntimeRegistry.resolve(backend); ports.current();
    backendById(backend).validateTurnOptions(options);
    if (!runtime.capabilities.permissionModes.includes(options.permissionMode) || planMode && !runtime.capabilities.planMode ||
      payload.attachments?.some(item => item.kind === "image") && !runtime.capabilities.imageInput) throw new Error("input-unsupported");
  }
  // A browser's model choice persists on the Chat exactly as the desktop composer's does, so the next turn anywhere starts from it.
  // An Agent switch carries the choice on the switching turn instead: the switch itself installs the new Agent's options.
  if (chosen && !switching) {
    const persisted = await ports.store.patchOptions({ chatId: command.chatId, expectedAgent: agent, expectedAgentRevision: facts.agentRevision,
      expectedChatRecordRevision: facts.chatRecordRevision, patch: chosen }); ports.current();
    ports.publishRecord?.(persisted);
    const patched = builtinOptions(persisted.options);
    if (!patched) throw new Error("agent-unavailable");
    options = structuredClone(patched);
  }
  if (options.permissionMode === "full-access" && !remoteConsentMatches(payload.fullAccessConsent, {
    userId: scope.userId, sourceDeviceId: command.sourceDeviceId, chatId: command.chatId, incarnationId: command.incarnationId,
    targetDeviceId: command.targetDeviceId, intentId: command.commandId,
  })) throw new Error("permission-required");
  if (canonicalJson((ports.remoteInput ?? []).map(item => item.attachment)) !== canonicalJson(payload.attachments ?? [])) throw new Error("attachment-unavailable");
  const nodes = payload.references?.length ? await (() => {
    if (!ports.references) throw new Error("workspace-file-unavailable");
    return ports.references.references(command.chatId, payload.references!, backend, planMode, ports.current);
  })() : [];
  ports.current();
  const precondition = { kind: "existing" as const, incarnationId: command.incarnationId };
  const message = { id: stableId("user", command.commandId), role: "user" as const, content: payload.text, createdAt: command.createdAt };
  const submission: TrustedManualTurnSubmission = {
    ...(payload.kind === "retry-authentication" ? { authenticationRetry: { kind: "retry-authentication" as const } } : {}), intentId: command.commandId, expectedAgentRevision: payload.expectedAgentRevision,
    ...(switching ? { agentSwitch: { expectedAgent: agent, expectedAgentRevision: payload.expectedAgentRevision,
      expectedChatRecordRevision: facts.chatRecordRevision, targetAgent: backend } } : {}),
    persistence: { kind: "append", input: { chatId: command.chatId, precondition, message, ...(payload.revision ? { revise: payload.revision } : {}) } }, precondition,
    workspacePrecondition: remoteWorkspace(facts, ports), content: remoteText(payload.text, command.commandId),
    turn: { requestId: stableId("request", command.commandId), scope: { conversationId: command.chatId },
      turnOptions: options, planMode,
      input: payload.text.trim() ? [{ type: "text", text: payload.text }] : [] } };
  if (nodes.length) {
    submission.content.content.richValue.push(...nodes);
    submission.turn.input = projectRichInput(submission.content.content.richValue);
    submission.content.content.displayText = richInputDisplayText(submission.content.content.richValue);
    message.content = submission.content.content.displayText;
  }
  if (ports.remoteInput?.length) {
    submission.remoteInput = ports.remoteInput;
    submission.content.content.files = ports.remoteInput.map(({ attachment }) => ({ id: attachment.attachmentId, type: "file", filename: attachment.filename, mediaType: attachment.blob.mime }));
    return submission;
  }
  return validateManualTurnSubmission(submission);
}
/**
 * U06 Q7-c: a reservation's first message becomes the create-app a local first send of the App's first Edit Chat makes, under the ids its
 * creation derives (the ledger checks them again, §8.4.3) and the reservation's own Agent. Text only for now: attachments and workspace
 * references are refused by name, and the phone switches no Agent on a Chat that does not exist yet.
 */
export async function mapRemoteFirstMessage(command: RemoteCommand, target: { appId: string; projectId: string }, scope: SyncScope,
  ports: Pick<Ports, "defaults" | "current">) {
  const payload = command.payload, creation = command.intent?.creation;
  if (payload.kind !== "start-turn" || !creation || !command.intent) throw new Error("admission-failed");
  if (payload.attachments?.length || payload.references?.length || payload.agentSelection) throw new Error("input-unsupported");
  const backend = command.intent.baselineAgent, planMode = payload.planMode ?? false;
  let options = ports.defaults(backend);
  if (payload.permissionMode) options.permissionMode = payload.permissionMode;
  const chosen = remoteModelPatch(payload.options, options);
  if (chosen) options = { ...options, ...chosen } as AgentTurnOptions;
  backendById(backend).validateTurnOptions(options);
  if (payload.permissionMode || planMode) {
    const runtime = await backendRuntimeRegistry.resolve(backend); ports.current();
    if (!runtime.capabilities.permissionModes.includes(options.permissionMode) || planMode && !runtime.capabilities.planMode) throw new Error("input-unsupported");
  }
  if (options.permissionMode === "full-access" && !remoteConsentMatches(payload.fullAccessConsent, {
    userId: scope.userId, sourceDeviceId: command.sourceDeviceId, chatId: command.chatId, incarnationId: command.incarnationId,
    targetDeviceId: command.targetDeviceId, intentId: command.commandId,
  })) throw new Error("permission-required");
  ports.current();
  const firstMessage = { id: stableId("user", command.commandId), role: "user" as const, content: payload.text, createdAt: command.createdAt };
  return validateManualTurnSubmission({ intentId: command.commandId, expectedAgentRevision: 0,
    precondition: { kind: "absent", proposedIncarnationId: command.incarnationId }, workspacePrecondition: { kind: "app", appId: target.appId },
    content: remoteText(payload.text, command.commandId),
    persistence: { kind: "create-app", input: { id: command.chatId, incarnationId: command.incarnationId, appId: target.appId, projectId: target.projectId,
      appRole: "edit", agent: backend, options, firstMessage } },
    turn: { requestId: stableId("request", command.commandId), scope: { conversationId: command.chatId }, turnOptions: options, planMode,
      input: payload.text.trim() ? [{ type: "text", text: payload.text }] : [] } }) as TrustedManualTurnSubmission;
}

