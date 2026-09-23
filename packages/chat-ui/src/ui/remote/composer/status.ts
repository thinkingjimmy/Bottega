/**
 * [INPUT]: Depends on the account's computer list, confirmed remote targets, the chat head's preparation facts, the host's reason remote control cannot be used and remote copy.
 * [OUTPUT]: Provides draftBudget (text over its limit, or references too large for one command), ownerPresence (with the last-seen moment), ownerBlock (an offline owner named with why and when it went dark), ownerCommandBlock and handledElsewhereBlock (why the owning computer cannot take the next message or carry out a command, and the answer when another controller got there first — presence from the account subscription, Project facts from the chat's target), readOnlyGate (the read-only card for an imported chat or a revoked computer), sendAction and the draft budget label.
 * [POS]: Pure presentation rules shared by creation and conversation; both name the computer that owns the chat, and nothing here submits or moves one.
 */
import { computerOf, computerOnline, type CloudComputer } from "@ai-chat/cloud-protocol";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { handledElsewhere, REMOTE_LIMITS, type RemoteCommandReceipt, type RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { remoteDraftBytes, REMOTE_COMMAND_PLAINTEXT_BYTES } from "@ai-chat/cloud-protocol/remote/encrypted/client";
import { utf8Length } from "@ai-chat/cloud-protocol/chats/content/parts";
import { relativeMoment } from "@ai-chat/ui/components/account/moment";
import { backendName, type RemoteCopy } from "../../../i18n/remote";
/** The owning computer as the account's computer list reports it: presence never comes from a per-chat read. */
export type OwnerPresence = { name: string; online: boolean; protocolVersion: number; lastSeenReason: CloudComputer["lastSeenReason"]; lastSeenAt: number | null };
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
    protocolVersion: installation.protocolVersion, lastSeenReason: computer.lastSeenReason, lastSeenAt: computer.lastSeenAt };
}
export type OwnerBlock = {
  /** The one sentence naming the state: what the Send button's tooltip says. */
  reason: string;
  /** What to do about it on that computer, when there is something to do. */
  hint: string | null;
  /** A computer that has left the account will not come back; the chat is read-only for good. */
  gone: boolean;
};
type OwnerFacts = {
  owner: OwnerPresence | null;
  /** The chat names an owning installation the account no longer has. */
  revoked: boolean;
  ownerDeviceId: string | null; target: RemoteTarget | undefined; protocol: number; loading: boolean; localDeviceId: string | null };
const named = (copy: RemoteCopy, facts: OwnerFacts, owner: OwnerPresence) =>
  facts.ownerDeviceId && facts.ownerDeviceId === facts.localDeviceId ? copy.local.replace("{name}", owner.name) : owner.name;
/**
 * "Studio Mac is asleep · 5 minutes ago": why it went dark, when it was last seen. A lid closed and a lost network read
 * differently because they are fixed differently; a quit or an unknown reason is plain offline. The moment reads the
 * clock, so a caller that re-renders on its presence tick keeps it current.
 */
function offlineLine(copy: RemoteCopy, owner: OwnerPresence, name: string) {
  const [bare, since] = owner.lastSeenReason === "sleep" ? [copy.computerAsleep, copy.computerAsleepSince]
    : owner.lastSeenReason === "network" ? [copy.computerDisconnected, copy.computerDisconnectedSince] : [copy.computerOffline, copy.computerOfflineSince];
  const line = owner.lastSeenAt === null ? bare : since.replace("{when}", relativeMoment(owner.lastSeenAt, copy.lang));
  return line.replace("{name}", name);
}
/**
 * Why the owning computer cannot take the next message, or null when it can. Presence and version come from the
 * account's computer list; only the Project facts, which are about this chat, come from its target.
 */
export function ownerBlock(copy: RemoteCopy, facts: OwnerFacts): OwnerBlock | null {
  const { owner } = facts;
  if (!owner) return facts.revoked ? { reason: copy.computerRevoked, hint: null, gone: true } : null;
  const name = named(copy, facts, owner);
  if (!owner.online) return { reason: offlineLine(copy, owner, name),
    hint: owner.lastSeenReason === "sleep" ? copy.wakeThere : owner.lastSeenReason === "network" ? copy.networkThere : copy.openThere, gone: false };
  if (owner.protocolVersion !== facts.protocol) return { reason: copy.computerUpdate.replace("{name}", name), hint: copy.updateThere, gone: false };
  if (facts.target?.reason === "local-facts-pending") return { reason: copy.projectPending, hint: null, gone: false };
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
 * What the read-only card says, or null when the composer stays. An imported chat is always behind the card until it is
 * continued on the computer that holds it. A native chat keeps its composer even while its computer is asleep or behind a
 * version: those states retire themselves on the account subscription, so they belong on the Send button rather than on a
 * card that would take the draft away. Only a computer that has left the account replaces the composer for good.
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
