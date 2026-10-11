/**
 * [INPUT]: Account computer presence/health, confirmed targets, preparation facts, host access restrictions and shared remote/connection copy.
 * [OUTPUT]: Draft budgets, owner presence, temporary composer-cover decisions, permanent read-only gates, command restrictions and send actions.
 * [POS]: Pure rules for creation and conversation; temporary covers never clear drafts or create commands.
 */
import { computerOf, computerOnline, type CloudComputer } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { handledElsewhere, REMOTE_LIMITS, type RemoteCommandReceipt, type RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { remoteDraftBytes, REMOTE_COMMAND_PLAINTEXT_BYTES } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { utf8Length } from "@ai-chat/cloud-protocol/chats/content/parts";
import { computerCopy } from "@ai-chat/ui/components/feedback/computer-copy";
import { backendName, type RemoteCopy } from "../../../i18n/messages/remote";
/** The owning computer as the account's computer list reports it: presence never comes from a per-chat read. */
export type OwnerPresence = { name: string; online: boolean; protocolVersion: number; lastSeenReason: CloudComputer["lastSeenReason"]; lastSeenAt: number | null; health?: CloudComputer["remoteHealth"] };
/**
 * Which computer owns this chat, and whether it is up. The account's list is the authority and retires a stale
 * "online" itself; a host that has not subscribed yet reads the chat's own target, which carries the same four facts.
 * Null means the chat's computer is not one of the account's any more — a revoked installation.
 */
export function ownerPresence(input: { computers: CloudComputer[] | null; target: RemoteTarget | undefined; ownerDeviceId: string | null; now: number }): OwnerPresence | null {
  const { computers, target, ownerDeviceId } = input;
  if (!computers) return target ? { name: target.name, online: target.online, protocolVersion: target.protocolVersion,
    lastSeenReason: target.lastSeenReason ?? "unknown", lastSeenAt: target.offlineAt } : null;
  const computer = computerOf(computers, ownerDeviceId);
  if (!computer) return null;
  const installation = computer.installations.find(item => item.deviceId === ownerDeviceId)!;
  return { name: computer.name, online: computerOnline(computer, input.now),
    protocolVersion: installation.protocolVersion, lastSeenReason: computer.lastSeenReason, lastSeenAt: computer.lastSeenAt, health: computer.remoteHealth };
}
export type OwnerBlock = {
  /** The one sentence naming the state: what the Send button's tooltip says. */
  reason: string;
  /** What to do about it on that computer, when there is something to do. */
  hint: string | null;
  /** A computer that has left the account will not come back; the chat is read-only for good. */
  gone: boolean;
  title?: string;
  loading?: boolean;
  replacesComposer?: boolean;
};
type OwnerFacts = {
  owner: OwnerPresence | null;
  /** The chat names an owning installation the account no longer has. */
  revoked: boolean;
  ownerDeviceId: string | null; target: RemoteTarget | undefined; protocol: number; loading: boolean; localDeviceId: string | null };
const named = (copy: RemoteCopy, facts: OwnerFacts, owner: OwnerPresence) =>
  facts.ownerDeviceId && facts.ownerDeviceId === facts.localDeviceId ? copy.local.replace("{name}", owner.name) : owner.name;
/**
 * Why the owning computer cannot take the next message, or null when it can. Presence and version come from the
 * account's computer list; only the Project facts, which are about this chat, come from its target.
 */
export function ownerBlock(copy: RemoteCopy, facts: OwnerFacts): OwnerBlock | null {
  const { owner } = facts, feedback = computerCopy(copy.lang);
  if (!owner) return facts.revoked ? { reason: copy.computerRevoked, hint: null, gone: true } : null;
  const name = named(copy, facts, owner);
  if (!owner.online) return { reason: (owner.lastSeenReason === "sleep" ? feedback.wake : owner.lastSeenReason === "network" ? feedback.computerBody : feedback.open).replace("{name}", name),
    title: owner.lastSeenReason === "sleep" ? feedback.computerAsleep : feedback.computerUnavailable, hint: null, gone: false, replacesComposer: true };
  const health = owner.health?.status;
  if (health === "initializing" || health === "recovering") return { reason: feedback.loading, hint: null, gone: false, loading: true, replacesComposer: true };
  if (health === "locked" || health === "memory-blocked") return { reason: (health === "locked" ? feedback.locked : feedback.privacy).replace("{name}", name), hint: null, gone: false, replacesComposer: true };
  if (facts.protocol >= 0 && owner.protocolVersion !== facts.protocol) return { reason: copy.computerUpdate.replace("{name}", name), hint: copy.updateThere, gone: false };
  if (facts.target?.reason === "local-facts-pending") return { reason: feedback.loading, hint: null, gone: false, loading: true, replacesComposer: true };
  if (facts.target?.projectBound === false) return { reason: copy.projectUnbound, hint: null, gone: false };
  return null;
}
/**
 * Whether the computer that owns this content can be asked to carry out a command — deleting a Chat, say — and the
 * sentence to say when it cannot. Presence only: a command that erases content on the owning computer needs that
 * computer awake, while a version gap is not this surface's business. Record writes never ask: renaming, archiving
 * and reordering are the account's, and the owner reconciles them when it wakes.
 */
export function ownerCommandBlock(copy: RemoteCopy, input: { computers: CloudComputer[] | null; ownerDeviceId: string | null; now: number; localDeviceId?: string | null }) {
  const owner = ownerPresence({ computers: input.computers, target: undefined, ownerDeviceId: input.ownerDeviceId, now: input.now });
  return ownerBlock(copy, { owner, revoked: Boolean(input.computers && input.ownerDeviceId && !owner),
    ownerDeviceId: input.ownerDeviceId, target: undefined, protocol: owner?.protocolVersion ?? 0,
    loading: false, localDeviceId: input.localDeviceId ?? null });
}
/**
 * What a control surface says about a command the owner had already carried out for another controller: one
 * sentence naming that computer, shaped like every other block so it renders beside the disabled control rather
 * than as a failure. An answer recovered without its winner falls back to the unnamed sentence.
 */
export function handledElsewhereBlock(copy: RemoteCopy, receipt: Pick<RemoteCommandReceipt, "result" | "resolvedBy"> | null | undefined): OwnerBlock | null {
  const handled = handledElsewhere(receipt);
  if (!handled) return null;
  return { reason: handled.deviceName ? copy.handledOn.replace("{name}", handled.deviceName) : copy.alreadyResolved, hint: null, gone: false };
}
export type ReadOnlyGate = { description: string };
type GateFacts = OwnerFacts & { imported: boolean; blocked: string | null; agent: string };
/**
 * Permanent access guidance for imported Chats and revoked computers. Temporary connection covers are separate;
 * both replace the editor without discarding the draft held by the parent store.
 */
export function readOnlyGate(copy: RemoteCopy, facts: GateFacts): ReadOnlyGate | null {
  const block = ownerBlock(copy, facts);
  if (!facts.imported && !block?.gone) return null;
  if (facts.blocked) return { description: facts.blocked };
  if (facts.loading && !facts.owner) return { description: copy.connecting };
  const lead = facts.imported ? [copy.importedFrom.replace("{agent}", backendName(facts.agent))] : [];
  const parts = !facts.owner ? [copy.computerRevoked]
    : block ? [block.reason, ...(block.hint ? [block.hint] : [])]
      : [copy.continueThere.replace("{name}", named(copy, facts, facts.owner))];
  return { description: [...lead, ...parts].join(copy.sentenceGap) };
}
export type SendAction =
  | { kind: "send"; busy: boolean }
  | { kind: "retry-preparation" | "retry-create"; label: string };
/** The Send button is the required action when there is one: retrying a blocked preparation or an unknown creation. Send itself prepares an unprepared computer. */
export function sendAction(copy: RemoteCopy, facts: { head: CloudChatHead | null; target: RemoteTarget | undefined; ready: boolean; busy: boolean; retryCreate: boolean }): SendAction {
  if (facts.retryCreate) return { kind: "retry-create", label: copy.retryShort };
  if (facts.head && facts.target && !facts.ready && facts.head.executionPreparation?.state === "blocked") return { kind: "retry-preparation", label: copy.retryPreparation };
  return { kind: "send", busy: facts.busy };
}
/** What stops a draft on size alone: text over its own limit ("34.1 / 32 KB"), or references that leave one command no room (RA-15). */
export function draftBudget(copy: RemoteCopy, draft: { text: string; references: readonly RemoteReference[]; files: number }): string | null {
  const bytes = utf8Length(draft.text);
  if (bytes > REMOTE_LIMITS.textBytes) return budgetLabel(copy, bytes, REMOTE_LIMITS.textBytes);
  return remoteDraftBytes(draft) > REMOTE_COMMAND_PLAINTEXT_BYTES ? copy.referencesTooLarge : null;
}
/** The draft budget, shown only once exceeded: "34.1 / 32 KB". */
export function budgetLabel(copy: RemoteCopy, usedBytes: number, limitBytes: number) {
  const format = (bytes: number) => (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return copy.budget.replace("{used}", format(usedBytes)).replace("{limit}", format(limitBytes));
}
