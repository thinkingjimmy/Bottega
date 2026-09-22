/**
 * [INPUT]: Exact creation receipt, frozen send intent, account identity and six platform ports.
 * [OUTPUT]: Waits only for local head identity, then durably submits the first intent before target preparation.
 * [POS]: Shared first-send continuation; cancellation ends automatic submission without erasing the Chat or draft.
 */
import { assertRemoteReferenceTarget, type RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { awaitChatHead } from "../commands/await-head";
import type { ChatPlatform } from "../../contracts";
import type { RemoteCreated, RemoteCreateInput } from "../contracts";
import { remoteCommandSession } from "../commands/registry";
import type { RemoteDraftStore } from "../input/draft";
import { remoteConsentFor, type RemoteConsentScope, type RemoteFullAccessConsent, type RemotePermissionMode } from "@ai-chat/cloud-protocol/remote/input/model";
import { remoteReasonSchema, type RemoteReason, type RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
export class FirstMessageFailure extends Error {
  constructor(readonly reason: RemoteReason) { super(reason); }
}
function fail(reason: RemoteReason): never { throw new FirstMessageFailure(reason); }
export type FirstMessageIntent = { text: string; commandId: string; creation: RemoteCreateInput; draftStore?: RemoteDraftStore; permissionMode?: RemotePermissionMode; planMode?: boolean; options?: RemoteTurnOptions; references?: readonly RemoteReference[] };
export async function sendFirstMessage(platform: Pick<ChatPlatform, "account" | "chats" | "commands" | "execution">, receipt: RemoteCreated, intent: FirstMessageIntent, signal: AbortSignal,
  confirm?: (scope: RemoteConsentScope) => Promise<RemoteConsentScope | null>) {
  const owner = platform.account.snapshot(), abort = new AbortController();
  const cancel = () => abort.abort();
  const valid = () => {
    const current = platform.account.snapshot();
    return !signal.aborted && !abort.signal.aborted && !platform.commands.remote?.lifetime?.aborted && current.state === "ready" && current.profile?.userId === owner.profile?.userId && current.deviceId === owner.deviceId;
  };
  signal.addEventListener("abort", cancel, { once: true });
  platform.commands.remote?.lifetime?.addEventListener("abort", cancel, { once: true });
  const stopAccount = platform.account.subscribe(() => { if (!valid()) cancel(); });
  try {
    if (!valid()) fail("identity-changed");
    const session = remoteCommandSession(platform, receipt.chatId, receipt.incarnationId);
    if (!session) fail("remote-disabled");
    const previous = session.snapshot().entries.find(entry => entry.input.commandId === intent.commandId);
    if (previous) {
      const receipt = previous.receipt ?? await session.retry(intent.commandId);
      if (!receipt) fail(previous.rejected === "attachment-unavailable" ? "attachment-unavailable" : previous.rejected ? "capacity-exceeded" : "outcome-unknown");
      if (["expired", "rejected", "outcome-unknown"].includes(receipt.state)) fail(receipt.reason ?? "outcome-unknown");
      return receipt;
    }
    const head = await awaitChatHead(platform.chats, receipt, abort.signal);
    if (!head || !valid()) fail("identity-changed");
    if (head.ownerDeviceId !== receipt.ownerDeviceId) fail("not-owner");
    const execution = platform.execution.remote;
    if (!execution) fail("remote-disabled");
    const target = await firstMessageTarget(execution, receipt, abort.signal);
    if (target.reason) fail(target.reason);
    if (target.projectBound === false) fail("project-path-unbound");
    const agent = target.agents.find(agent => agent.backend === intent.creation.backend);
    if (!agent?.available) fail(agent?.reason ?? "agent-unavailable");
    const references = intent.references ?? intent.draftStore?.snapshot().references.map(reference => reference.value) ?? [];
    assertRemoteReferenceTarget(references, receipt.ownerDeviceId);
    const attachments = await intent.draftStore?.prepare(receipt.chatId, platform.commands.remote?.attachments, abort.signal) ?? [];
    if (!valid()) fail("identity-changed");
    const capability = target.agents.find(agent => agent.backend === intent.creation.backend)?.capabilities;
    if (attachments.some(file => file.kind === "image" ? !capability?.imageInput : !capability?.fileInput) || intent.planMode && !capability?.planMode ||
      intent.permissionMode && capability && !capability.permissionModes.includes(intent.permissionMode)) fail("input-unsupported");
    let fullAccessConsent: RemoteFullAccessConsent | null = null;
    if (intent.permissionMode === "full-access") {
      if (!owner.profile?.userId || !owner.deviceId || !confirm) fail("permission-required");
      const scope = await confirm({ userId: owner.profile.userId, sourceDeviceId: owner.deviceId, chatId: receipt.chatId, incarnationId: receipt.incarnationId,
        targetDeviceId: receipt.ownerDeviceId });
      fullAccessConsent = scope && remoteConsentFor(scope, intent.commandId, receipt.ownerDeviceId);
      if (!fullAccessConsent || !valid()) fail("permission-required");
    }
    // The original request survives an unknown result through the same session used by the detail view.
    const submitted = await session.submit({ commandId: intent.commandId, chatId: receipt.chatId, incarnationId: receipt.incarnationId,
      targetDeviceId: receipt.ownerDeviceId, intent: { baselineAgent: head.chat.agent },
      payload: { kind: "start-turn", text: intent.text, expectedAgentRevision: head.chat.agentRevision,
        ...(attachments.length ? { attachments } : {}), ...(references.length ? { references: [...references] } : {}), ...(intent.permissionMode ? { permissionMode: intent.permissionMode } : {}),
        ...(intent.planMode !== undefined ? { planMode: intent.planMode } : {}), ...(intent.options ? { options: intent.options } : {}), ...(fullAccessConsent ? { fullAccessConsent } : {}) } }, abort.signal);
    if (!valid()) fail("identity-changed");
    if (!submitted) {
      const rejected = session.snapshot().entries.find(entry => entry.input.commandId === intent.commandId)?.rejected;
      fail(rejected === "attachment-unavailable" ? "attachment-unavailable" : rejected ? "capacity-exceeded" : "outcome-unknown");
    }
    if (["expired", "rejected", "outcome-unknown"].includes(submitted.state)) fail(submitted.reason ?? "outcome-unknown");
    return submitted;
  } catch (error) {
    if (error instanceof FirstMessageFailure) throw error;
    if (!valid()) throw new FirstMessageFailure("identity-changed");
    const reason = remoteReasonSchema.safeParse(error && typeof error === "object" && "data" in error ? error.data : error instanceof Error ? error.message : error);
    throw new FirstMessageFailure(reason.success ? reason.data : "execution-not-ready");
  } finally {
    stopAccount(); signal.removeEventListener("abort", cancel);
    platform.commands.remote?.lifetime?.removeEventListener("abort", cancel);
    abort.abort();
  }
}
async function firstMessageTarget(execution: NonNullable<ChatPlatform["execution"]["remote"]>, receipt: RemoteCreated, signal: AbortSignal) {
  let targets = await execution.targets({ chatId: receipt.chatId, cursor: null });
  const cursors = new Set<string>();
  while (!targets.items.some(item => item.deviceId === receipt.ownerDeviceId) && !targets.complete && targets.cursor && cursors.size < 20) {
    if (cursors.has(targets.cursor) || signal.aborted) fail("identity-changed");
    cursors.add(targets.cursor); targets = await execution.targets({ chatId: receipt.chatId, cursor: targets.cursor });
  }
  const target = targets.items.find(item => item.deviceId === receipt.ownerDeviceId);
  signal.throwIfAborted();
  if (!targets.remoteControlEnabled) fail("remote-disabled");
  if (!target) fail("device-revoked");
  if (!target.online || target.offlineAt !== null && targets.serverTime >= target.offlineAt) fail("device-offline");
  if (target.protocolVersion !== targets.sourceProtocolVersion) fail("protocol-mismatch");
  return target;
}
