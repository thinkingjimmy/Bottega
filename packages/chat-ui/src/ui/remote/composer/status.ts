/**
 * [INPUT]: Depends on confirmed remote targets, the chat head's preparation facts, the host's reason remote control cannot be used and remote copy.
 * [OUTPUT]: Provides computerFace (a blocking reason outranks every other state, with distinct pending and unbound Project states), readOnlyGate (the read-only card's sentence and its filled/outline actions for an imported chat not yet continued, or a native chat whose computer is offline, outdated or revoked), sendAction and the draft budget label.
 * [POS]: Pure presentation rules shared by creation and conversation; nothing here submits or selects. A chat behind the card never reaches sendAction: the card stands where the composer would be.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import { backendName, type RemoteCopy } from "../../../i18n/remote";
import type { ComputerFace } from "../computer/selectors";
type Facts = {
  /** The sentence that explains why remote control cannot be used right now — disconnected or disabled — or null when it can. */
  blocked: string | null;
  loading: boolean; target: RemoteTarget | undefined; selected: boolean; protocol: number; revoked: boolean;
  attention: boolean; localDeviceId: string | null };
export function computerFace(copy: RemoteCopy, facts: Facts): ComputerFace {
  const { target } = facts, glyph = target?.platform ?? "none";
  const name = target ? target.deviceId === facts.localDeviceId ? copy.local.replace("{name}", target.name) : target.name : "";
  if (facts.blocked) return { glyph, tone: "dim", label: facts.blocked };
  if (facts.loading && !target) return { glyph: "none", tone: "dim", label: copy.connecting };
  if (facts.attention && target) return { glyph, tone: "attention", label: name };
  if (facts.revoked) return { glyph: "none", tone: "dim", label: copy.revoked };
  if (!target) return { glyph: "none", tone: "dim", label: copy.noComputerOnline };
  if (!target.online) return { glyph, tone: "dim", label: `${name} · ${copy.offline}` };
  if (target.protocolVersion !== facts.protocol) return { glyph, tone: "dim", label: `${name} · ${copy.update}` };
  if (target.reason === "local-facts-pending") return { glyph, tone: "dim", label: `${name} · ${copy.projectPending}` };
  if (target.projectBound === false) return { glyph, tone: "dim", label: `${name} · ${copy.projectUnbound}` };
  if (!facts.selected) return { glyph, tone: "dim", label: name };
  return { glyph, tone: "ready", label: name };
}
export type ReadOnlyGate = {
  description: string;
  /** The filled action: continue on the executor (held while its Project facts are pending), bind this desktop's folder and continue, or choose another computer when the executor cannot take the chat. */
  primary: { kind: "continue" | "bind"; disabled: boolean } | { kind: "choose" } | null;
  /** The outline action: the computer menu beside a live Continue, or a re-read of the computers while the executor cannot take the chat. */
  secondary: "another" | "check" | null;
};
type GateFacts = { imported: boolean; blocked: string | null; loading: boolean; target: RemoteTarget | undefined; protocol: number; revoked: boolean; agent: string;
  othersOnline: boolean; bindable: boolean; localDeviceId: string | null; switchingTo: string | null };
/**
 * What the read-only card says and offers, or null when the composer stays. An imported chat is always behind the card until it is continued somewhere;
 * a native chat only while its computer cannot run anything — offline, needing an update or revoked. The executor's state decides the sentence, and only an action that can succeed is offered.
 */
export function readOnlyGate(copy: RemoteCopy, facts: GateFacts): ReadOnlyGate | null {
  const { target, imported } = facts;
  const unusable = target ? !target.online || target.protocolVersion !== facts.protocol : facts.revoked;
  if (!imported && !unusable) return null;
  const none = { primary: null, secondary: null };
  if (facts.blocked) return { description: facts.blocked, ...none };
  if (facts.switchingTo) return { description: imported ? copy.continuingOn.replace("{name}", facts.switchingTo) : copy.switching, ...none };
  if (facts.loading && !target) return { description: copy.connecting, ...none };
  const lead = imported ? [copy.importedFrom.replace("{agent}", backendName(facts.agent))] : [];
  const sentences = (...parts: string[]) => [...lead, ...parts].join(copy.sentenceGap);
  const choose = facts.othersOnline ? { kind: "choose" as const } : null;
  if (!target) return { description: sentences(copy.computerRevoked), primary: choose, secondary: "check" };
  const name = target.deviceId === facts.localDeviceId ? copy.local.replace("{name}", target.name) : target.name;
  if (!target.online) return { description: sentences(copy.computerOffline.replace("{name}", name), (target.lastSeenReason === "sleep" ? copy.wakeThere : target.lastSeenReason === "network" ? copy.networkThere : copy.openThere)), primary: choose, secondary: "check" };
  if (target.protocolVersion !== facts.protocol) return { description: sentences(copy.computerUpdate.replace("{name}", name), copy.updateThere), primary: choose, secondary: "check" };
  // Only an imported chat reaches its Project facts and the live Continue: a usable native computer keeps its composer.
  if (target.reason === "local-facts-pending") return { description: sentences(copy.projectPending), primary: { kind: "continue", disabled: true }, secondary: null };
  if (target.projectBound === false) return { description: sentences(copy.projectUnbound), primary: facts.bindable ? { kind: "bind", disabled: false } : choose, secondary: null };
  return { description: sentences(copy.continueThere.replace("{name}", name)), primary: { kind: "continue", disabled: false }, secondary: facts.othersOnline ? "another" : null };
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
/** The draft budget, shown only once exceeded: "34.1 / 32 KB". */
export function budgetLabel(copy: RemoteCopy, usedBytes: number, limitBytes: number) {
  const format = (bytes: number) => (bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return copy.budget.replace("{used}", format(usedBytes)).replace("{limit}", format(limitBytes));
}
