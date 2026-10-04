/**
 * [INPUT]: Depends on the Chat submission contract (TrustedManualTurnSubmission), the Agent-switch and Chat-options contracts, the frozen Agent configuration, the workflow Chat registry and ports for the coordinator, Chat facts and options, the Project's workspace precondition and validated turn options.
 * [OUTPUT]: Provides createAgentDispatch: the executor's AgentDispatch over the existing Chat machinery — one persistent Chat per record × role in the run's Project with a fixed title (created by the first turn, appended to afterwards), a system-origin turn with the step's prompt (the configuration's instructions first) and its workflow source (run, step, attempt, role) on the main-only submission field, the Project as workspace, and a stop that goes through the coordinator's cancel.
 *           A reused Chat takes this run's frozen options before its turn (A-03): the same Provider has its options patched, another Provider switches the Chat's Agent in place — still one Chat.
 * [POS]: W1 (06 §4): workflow turns enter the Chat FIFO and custody like any other turn; nothing here starts ACP. The turn's read-only policy and report were set by the executor under the same request id before this runs.
 */
import { builtinAgent, type ChatTurnOptions } from "../../../../../shared/chat-agent/options";
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { randomUUID } from "node:crypto";
import type { AgentBackendId, AgentTurnOptions } from "../../../../../shared/ipc/agent/agent-ipc";
import type { ChatOptionsPatch } from "../../../../../shared/chat-agent/contracts";
import type { ManualTurnReceipt, TrustedManualTurnSubmission } from "../../../../../shared/ipc/content/sections-ipc";
import type { WorkspacePrecondition } from "../../../../../shared/content/submission/submission";
import type { AgentDispatch } from "../../executor";
import type { WorkflowChatRegistry } from "../chats";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";

type Frozen = { resolved?: { provider?: string; fields?: Record<string, { value?: unknown }> } };
export type DispatchPorts = {
  submit(submission: TrustedManualTurnSubmission): Promise<ManualTurnReceipt>;
  cancel(requestId: string): Promise<unknown>;
  forceKill: AgentDispatch["forceKill"];
  verifyGroup: AgentDispatch["verifyGroup"];
  processOf: AgentDispatch["processOf"];
  /** The Chat's current incarnation, or null when it does not exist (yet). */
  incarnationOf(chatId: string): string | null;
  /** The Chat's canonical Agent, revisions and options, for the options patch or the Agent switch a reused Chat needs. */
  chatFacts(chatId: string): { agent: ProviderId; agentRevision: number; chatRecordRevision: number; options: Partial<ChatTurnOptions> } | null;
  /** The Chat store's own options patch (revision-checked), the same one a person's picker commits. */
  patchOptions(input: ChatOptionsPatch): Promise<unknown>;
  workspaceFor(runId: string): WorkspacePrecondition | null;
  /** The backend's defaults with the frozen configuration's model, effort and permission mode, validated by the backend. */
  turnOptionsFor(backend: AgentBackendId, fields: Record<string, { value?: unknown }>): AgentTurnOptions;
  isBackend(id: string): id is AgentBackendId;
  registry: WorkflowChatRegistry;
  /** The fixed title of a new record × role Chat ("{step} · {task}" in the interface language). */
  chatTitle(role: WorkflowRoleName, task: string): Promise<string>;
  now(): number;
};

export function createAgentDispatch(ports: DispatchPorts): AgentDispatch {
  return {
    async dispatch(input) {
      const frozen = input.config as Frozen;
      const provider = frozen.resolved?.provider ?? "";
      if (!ports.isBackend(provider)) throw new Error(`workflow-provider-unavailable:${provider}`);
      const workspace = ports.workspaceFor(input.runId);
      if (!workspace) throw new Error("workflow-project-unavailable");
      const fields = frozen.resolved?.fields ?? {};
      const turnOptions = ports.turnOptionsFor(provider, fields);
      /* The Chat is claimed before its first turn exists: a crash in between finds the same Chat, never a second one. */
      const chat = ports.registry.get(input.record, input.role)
        ?? await ports.registry.claim(input.record, input.role, { chatId: randomUUID(), incarnationId: randomUUID().replaceAll("-", ""),
          title: await ports.chatTitle(input.role, input.task) }, ports.now());
      const existing = ports.incarnationOf(chat.chatId);
      const stored = existing ? ports.chatFacts(chat.chatId) : null;
      if (existing && !stored) throw new Error("workflow-chat-unavailable");
      /* A workflow Chat only ever runs a built-in (a package provider is refused above): narrow its Agent, never cast (TASK-11 S3-b). */
      const storedAgent = stored ? builtinAgent(stored.agent) : null;
      if (stored && !storedAgent) throw new Error("workflow-chat-unavailable");
      const facts = stored && storedAgent ? { ...stored, agent: storedAgent } : null;
      /* A-03: the Chat is reused by later runs; the turn must run with this run's frozen options, not the last run's. */
      const agentSwitch = facts && facts.agent !== provider
        ? { expectedAgent: facts.agent, expectedAgentRevision: facts.agentRevision, expectedChatRecordRevision: facts.chatRecordRevision, targetAgent: provider } : undefined;
      if (facts && !agentSwitch) {
        const patch = optionsPatch(facts.options, turnOptions);
        if (patch) await ports.patchOptions({ chatId: chat.chatId, expectedAgent: facts.agent, expectedAgentRevision: facts.agentRevision,
          expectedChatRecordRevision: facts.chatRecordRevision, patch });
      }
      const instructions = typeof fields.instructions?.value === "string" && fields.instructions.value ? `${fields.instructions.value}\n\n` : "";
      const text = `${instructions}${input.prompt}`;
      const message = { id: `${input.requestId}-user`, role: "user" as const, content: text, createdAt: ports.now() };
      const precondition = existing ? { kind: "existing" as const, incarnationId: existing } : { kind: "absent" as const, proposedIncarnationId: chat.incarnationId };
      const submission: TrustedManualTurnSubmission = {
        intentId: `${input.requestId}-intent`,
        ...(facts ? { expectedAgentRevision: facts.agentRevision } : {}),
        ...(agentSwitch ? { agentSwitch } : {}),
        persistence: existing
          ? { kind: "append", input: { chatId: chat.chatId, message, precondition } }
          : { kind: "create", input: { id: chat.chatId, agent: provider, options: turnOptions, firstMessage: message, incarnationId: chat.incarnationId,
            /* The Chat belongs to the Project it works in, so Project removal fences and cleans it like any of the Project's Chats. */
            projectId: workspace.kind === "project" ? workspace.projectId : null } },
        content: { schemaVersion: 1, origin: "system", capabilityEpoch: 0, backendEpoch: 0, content: { richValue: [], displayText: text, files: [] } },
        precondition,
        workspacePrecondition: workspace,
        workflow: { runId: input.runId, stepId: input.stepId, attempt: input.attempt, role: input.role },
        turn: { requestId: input.requestId, scope: { conversationId: chat.chatId }, turnOptions, input: [{ type: "text", text }] },
      };
      const receipt = await ports.submit(submission);
      if (receipt.phase === "failed") throw new Error("workflow-turn-not-admitted");
      return { chatId: chat.chatId, incarnationId: existing ?? chat.incarnationId };
    },
    async stop(requestId) { await ports.cancel(requestId); },
    forceKill: requestId => ports.forceKill(requestId),
    verifyGroup: group => ports.verifyGroup(group),
    processOf: requestId => ports.processOf(requestId),
  };
}

/** The frozen turn fields as a patch when any differs from the Chat's, or null; a field the frozen options leave out is cleared. */
const TURN_FIELDS = ["model", "reasoningEffort", "permissionMode"] as const;
function optionsPatch(current: Readonly<Partial<Record<(typeof TURN_FIELDS)[number], unknown>>>, next: AgentTurnOptions): ChatOptionsPatch["patch"] | null {
  if (TURN_FIELDS.every(key => current[key] === next[key])) return null;
  return Object.fromEntries(TURN_FIELDS.filter(key => next[key] !== undefined || current[key] !== undefined).map(key => [key, next[key]])) as ChatOptionsPatch["patch"];
}
