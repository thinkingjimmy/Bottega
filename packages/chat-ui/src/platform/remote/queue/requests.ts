/**
 * [INPUT]: Fresh Chat and target facts, complete retained input and scoped Full Access consent.
 * [OUTPUT]: Validated immutable start-turn requests for queue admission and atomic exchange.
 * [POS]: Queue request preparation shared by visible actions and the account-lifetime drain.
 */
import type { ChatPlatform } from "../../contracts";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { QueuedInput } from "@ai-chat/cloud-protocol/remote/queue";
import { remoteConsentFor, remoteConsentScopeMatches, type RemoteConsentScope } from "@ai-chat/cloud-protocol/remote/input/model";
import { assertRemoteReferenceTarget } from "@ai-chat/cloud-protocol/remote/input/references";
import type { SubmittedDraft, RemoteDraftStore } from "../input/draft";
import type { RemoteCommandInput } from "../contracts";

export async function queueTarget(platform: ChatPlatform, previous: CloudChatHead) {
  const port = platform.commands.remote, signal = port?.lifetime ?? new AbortController().signal;
  const [head, targets] = await Promise.all([platform.chats.head(previous.chat.id, signal), platform.execution.remote?.targets({ chatId: previous.chat.id, cursor: null })]);
  if (!head || head.chat.incarnationId !== previous.chat.incarnationId || head.ownerDeviceId !== previous.ownerDeviceId || head.archivedAt !== null) throw new Error("chat-incarnation-mismatch");
  let page = targets, target = page?.items.find(item => item.deviceId === head.ownerDeviceId);
  while (!target && page && !page.complete && page.cursor) {
    page = await platform.execution.remote!.targets({ chatId: head.chat.id, cursor: page.cursor });
    target = page.items.find(item => item.deviceId === head.ownerDeviceId);
  }
  if (!target?.online || target.offlineAt === null || target.offlineAt <= (targets?.serverTime ?? Date.now())) throw new Error("device-offline");
  if (!targets?.remoteControlEnabled || target.protocolVersion !== targets.sourceProtocolVersion || !target.projectBound) throw new Error("input-unsupported");
  if (targets.sourceDeviceId !== platform.account.snapshot().deviceId) throw new Error("identity-changed");
  return { head, target };
}
export async function queueStart(platform: ChatPlatform, previous: CloudChatHead, store: RemoteDraftStore, commandId: string,
  value: SubmittedDraft, queueExchange?: QueuedInput, confirm?: (scope: RemoteConsentScope) => Promise<RemoteConsentScope | null>): Promise<RemoteCommandInput> {
  const { head, target } = await queueTarget(platform, previous), account = platform.account.snapshot();
  const settings = value.settings ?? { backend: head.chat.agent, permissionMode: head.chat.options.permissionMode ?? "approve-for-me" };
  const capabilities = target.agents.find(agent => agent.backend === settings.backend && agent.available)?.capabilities;
  if (!capabilities || !capabilities.permissionModes.includes(settings.permissionMode) || value.planMode && !capabilities.planMode ||
    value.files.some(file => !file.attachment || file.state !== "ready" || (file.image ? !capabilities.imageInput : !capabilities.fileInput))) throw new Error("input-unsupported");
  const references = value.references.map(reference => reference.value);
  assertRemoteReferenceTarget(references, target.deviceId);
  let fullAccessConsent;
  if (settings.permissionMode === "full-access") {
    if (!account.profile || !account.deviceId) throw new Error("identity-changed");
    const scope = { userId: account.profile.userId, sourceDeviceId: account.deviceId, chatId: head.chat.id, incarnationId: head.chat.incarnationId, targetDeviceId: target.deviceId };
    const granted = remoteConsentScopeMatches(store.snapshot().consent, scope) ? store.snapshot().consent : await confirm?.(scope);
    if (!granted) throw new Error("full-access-consent-required");
    fullAccessConsent = remoteConsentFor(granted, commandId, target.deviceId)!;
  }
  return { commandId, chatId: head.chat.id, incarnationId: head.chat.incarnationId, targetDeviceId: target.deviceId,
    intent: { baselineAgent: head.chat.agent }, payload: { kind: "start-turn", text: value.text, attachments: value.files.map(file => file.attachment!), references,
      expectedAgentRevision: head.chat.agentRevision, agentSelection: { backend: settings.backend, expectedFactRevision: head.catalogRevision },
      permissionMode: settings.permissionMode, planMode: value.planMode ?? false, ...(settings.options ? { options: settings.options } : {}),
      ...(queueExchange ? { queueExchange } : {}), ...(fullAccessConsent ? { fullAccessConsent } : {}) } };
}
