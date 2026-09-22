/**
 * [INPUT]: Depends on exact owner/request identity, original Agent bridge handlers and the existing Steer outbox.
 * [OUTPUT]: Applies closed remote controls with immutable retry evidence and original deadlines after asynchronous validation; a control this computer already settled for another controller reports the winning device with its already-resolved result.
 * [POS]: Intake control adapter; approvals, user input, cancellation and steering retain their original main handlers.
 */
import type { RemoteWorkspaceService } from "./input/references";
import { projectRichInput, richInputDisplayText } from "../../../../../shared/rich-input-projection";
import { isRemoteTurnPayload } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteCipherPort } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import type { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { RemoteCommand, RemoteCommandReport, RemoteAdmission } from "@ai-chat/cloud-protocol/remote/model";
import type { AgentTurn, } from "../../../backends/types";
import type { AgentBridgeIpcHandlers } from "../../../agent/bridge-ipc";
import type { RemoteContext, ControlReceipt } from "../../../sections/coordinator/remote/model";
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import { canonicalHash } from "../../../sections/coordinator/coordinator-values";
import type { ChatStore } from "../../../chats/chat-store";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { AccountTransport } from "../../runtime/transport";
import type { TurnRegistry } from "../../../turn-registry";
import type { SteerAdmission } from "../../../../../shared/agent-ipc";
import { isAgentApprovalDecision } from "../../../../../shared/agent-ipc";
import { validateSteerInput } from "../../../agent-payload-validation";
import { remoteRequest } from "./transport-error";
import { remoteText, remoteWorkspace } from "./submission";
import type { TrustedManualTurnSubmission } from "../../../../../shared/sections-ipc";
import { backendRuntimeRegistry } from "../../../backends";
type TrustedSteerAdmission = SteerAdmission & Pick<TrustedManualTurnSubmission, "remoteInput">;
type Ports = { references?: RemoteWorkspaceService | null; config: CloudBuildConfig; ledger: RelayLedger; store: ChatStore; projects: Pick<ProjectStore, "get">;
  turns: Pick<TurnRegistry<AgentTurn>, "byRequest">; transport: Pick<AccountTransport, "query">;
  crypto(): RemoteCipherPort; clock(): ServerClock; handlers(): AgentBridgeIpcHandlers; projectAvailable(projectId: string): boolean;
  prepareFiles?(command: RemoteCommand, current: () => void): Promise<NonNullable<TrustedManualTurnSubmission["remoteInput"]>> };
export function controlReport(receipt: ControlReceipt): RemoteCommandReport {
  if (receipt.state === "not-dispatched") return { state: "claimed", noAdmission: true };
  const admission: RemoteAdmission = { intentId: receipt.id, submissionHash: receipt.payloadHash, requestId: receipt.requestId, userMessageId: null };
  // A loser carries the winner's device, so the controller that lost the race can name the computer that answered.
  const resolvedBy = receipt.result === "already-resolved" && receipt.resolvedBy ? { resolvedBy: receipt.resolvedBy } : {};
  return receipt.state === "applied" ? { state: receipt.output?.kind === "fork-error" ? "error" : "done", admission, result: receipt.result, ...resolvedBy, ...(receipt.output ? { output: receipt.output } : {}), reason: receipt.output?.kind === "fork-error" ? "fork-failed" : null } : { state: "outcome-unknown", admission, reason: "outcome-unknown" };
}
export async function applyRemoteControl(command: RemoteCommand, context: RemoteContext, current: () => void, ports: Ports): Promise<RemoteCommandReport> {
  if (isRemoteTurnPayload(command.payload) || command.payload.kind === "fork-chat" || command.payload.kind === "list-workspace-files" || command.payload.kind === "read-workspace-file" || command.payload.kind === "withdraw-queued" || command.payload.kind === "reorder-queue") throw new Error("admission-failed");
  const { payload } = command, prior = ports.ledger.remote.control(command.commandId);
  if (prior) {
    if (!prior.remote || canonicalHash(prior.remote) !== canonicalHash(context)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
    if (payload.kind === "steer") {
      const intent = ports.ledger.read(state => state.steerIntents[command.commandId]);
      if (intent?.phase === "persisted" || intent?.phase === "transferred") return controlReport(await ports.ledger.remote.settleControl(command.commandId, "applied"));
    }
    const unstartedSteer = payload.kind === "steer" && prior.state === "prepared" &&
      !ports.ledger.read(state => state.steerIntents[command.commandId] || state.intentTombstones[command.commandId]);
    if (prior.state !== "not-dispatched" && !unstartedSteer) return controlReport(prior);
  }
  await ports.clock().assertBeforeEffect(command.expiresAt); current();
  const entry = ports.turns.byRequest(payload.requestId);
  if (!entry || entry.conversationId !== context.chatId || entry.incarnationId !== context.incarnationId) throw new Error("request-not-active");
  const recovery = "retryToken" in payload ? payload : null;
  const generation = recovery?.generation ?? entry.generation;
  const decided = () => Boolean(recovery && ports.ledger.read(state => Object.values(state.controlReceipts).some(value =>
    value.conversationId === entry.conversationId && value.incarnationId === entry.incarnationId && value.requestId === entry.requestId && value.generation === generation &&
    value.key === `recovery:${recovery.retryToken}` && value.state !== "not-dispatched")));

  const validate = async () => {
    current();
    const head = await remoteRequest(() => ports.transport.query("chats/metadata:head", { ...protocolHeader(ports.config), expectedUserId: context.scope.userId, encryptedSpace: { scope: ports.crypto().scope, keyPackageFingerprint: ports.crypto().keyPackageFingerprint }, chatId: context.chatId })); current();
    if (!head || head.chat.id !== context.chatId || head.remoteCreation || head.chat.incarnationId !== context.incarnationId) throw new Error("chat-incarnation-mismatch");
    if (head.ownerDeviceId !== context.targetDeviceId) throw new Error("not-owner");
    if (head.chat.classification.conversationKind !== "ordinary" || head.archivedAt !== null) throw new Error("chat-not-executable");
    const local = await ports.store.sync.read(context.scope, { type: "remote-admission", chatId: context.chatId }); current();
    if (local.type !== "remote-admission" || local.value?.execution?.head.ownerDeviceId !== context.targetDeviceId) throw new Error("not-owner");
    if (command.connectionEpoch !== context.connectionEpoch) throw new Error("connection-changed");
    if (ports.turns.byRequest(payload.requestId) !== entry || (!decided() && (entry.generation !== generation || entry.sourceTerminal))) throw new Error("request-not-active");
    await ports.clock().assertBeforeEffect(command.expiresAt); current();
    const authority = ports.ledger.remote.authority(context);
    await authority.validate(); current(); authority.current();
  };
  await validate();
  const renewed = ports.ledger.remote.authority(context);
  // Recovery inherits only the already admitted turn's permission choice, under fresh account/epoch authority.
  const fullAccess = (entry as typeof entry & { payload?: { turnOptions: { permissionMode: string } } }).payload?.turnOptions.permissionMode === "full-access";
  const trusted = { remote: context, generation, current: validate, authority: { validate: renewed.validate, current: renewed.current,
    fullAccessFor: (chatId: string, incarnationId: string) => { renewed.current(); return fullAccess && chatId === context.chatId && incarnationId === context.incarnationId; } } }, handlers = ports.handlers();
  switch (payload.kind) {
    case "retry-without-session": await handlers.retryWithoutSession(payload.requestId, payload.retryToken, trusted); break;
    case "retry-same-session": await handlers.retrySameSession(payload.requestId, payload.retryToken, trusted); break;
    case "abandon-fatal-turn": await handlers.abandonResumeFailure(payload.requestId, payload.retryToken, trusted); break;
    case "cancel": await handlers.cancel(payload.requestId, trusted); break;
    case "respond-approval": {
      if (!isAgentApprovalDecision(payload.decision)) throw new Error("interaction-expired");
      await handlers.respondApproval({ requestId: payload.requestId, approvalId: payload.approvalId, decision: payload.decision }, trusted); break;
    }
    case "respond-user-input": await handlers.respondUserInput({ requestId: payload.requestId, userInputId: payload.userInputId, answers: payload.answers }, trusted); break;
    case "steer": {
      const facts = ports.store.getMetadata(context.chatId); if (!facts) throw new Error("request-not-active");
      const input: TrustedSteerAdmission = prior ? prior.payload as TrustedSteerAdmission : { requestId: payload.requestId, outboxRef: command.commandId, createdAt: command.createdAt,
        input: payload.text.trim() ? [{ type: "text", text: payload.text }] : [], displayText: payload.text, content: remoteText(payload.text, command.commandId),
        workspacePrecondition: remoteWorkspace(facts, ports), userMessage: { id: command.commandId, role: "user", content: payload.text, createdAt: command.createdAt } };
      if (!prior && payload.references?.length) {
        if (!ports.references) throw new Error("workspace-file-unavailable");
        const nodes = await ports.references.references(context.chatId, payload.references, facts.agent, false, current);
        input.content.content.richValue.push(...nodes); input.input = projectRichInput(input.content.content.richValue);
        input.displayText = input.content.content.displayText = richInputDisplayText(input.content.content.richValue);
        input.userMessage.content = input.displayText;
      }
      if (!prior && payload.attachments?.length) {
        const runtime = await backendRuntimeRegistry.resolve(facts.agent); current();
        if (payload.attachments.some(item => item.kind === "image") && !runtime.capabilities.imageInput) throw new Error("input-unsupported");
        if (!ports.prepareFiles) throw new Error("attachment-unavailable");
        input.remoteInput = await ports.prepareFiles(command, current);
        input.content.content.files = input.remoteInput.map(({ attachment }) => ({ id: attachment.attachmentId, type: "file", filename: attachment.filename, mediaType: attachment.blob.mime }));
      }
      if (!input.remoteInput?.length) validateSteerInput(input);
      await ports.clock().assertBeforeEffect(command.expiresAt); current();
      await ports.ledger.remote.reserveControl({ id: command.commandId, conversationId: context.chatId, incarnationId: context.incarnationId, requestId: payload.requestId,
        generation, key: `steer:${command.commandId}`, payload: input, payloadHash: canonicalHash(input), remote: context });
      let invoked = false;
      let result;
      try {
        await validate(); invoked = true; result = await handlers.steer(input, trusted); current();
      } catch (error) {
        if (!invoked) await ports.ledger.remote.settleControl(command.commandId, "not-dispatched");
        throw error;
      }
      if (result.outcome === "failed" && ports.ledger.remote.control(command.commandId)?.state === "not-dispatched") throw new Error(result.reason);
      if (result.outcome === "injected" && result.persistState === "persisted" || result.outcome === "unconsumed") await ports.ledger.remote.settleControl(command.commandId, "applied");
      break;
    }
  }
  current();
  const receipt = ports.ledger.remote.control(command.commandId); if (!receipt) throw new Error("REMOTE_CONTROL_UNAVAILABLE");
  return controlReport(receipt);
}
