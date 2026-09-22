/**
 * [INPUT]: Depends on the account's computer projection, the viewed-computer scope, a Project's display-only origin and the shared remote copy and owner-command gate.
 * [OUTPUT]: Provides draftCreationTarget — the installation a new Chat is created on — plus computerCommandBlock and viewedComputerBlock, the one sentence saying why a computer cannot be asked to create one.
 * [POS]: The creation rule for lib/cloud/computers, read by the desktop draft and by every create control in the sidebar; it names a target and never submits anything.
 */
import { computerOf, type CloudComputer } from "@ai-chat/cloud-protocol";
import { ownerCommandBlock } from "@ai-chat/chat-ui/remote-status";
import { remoteCopy } from "@ai-chat/chat-ui/remote-copy";
import type { Project } from "../../../../shared/projects-ipc";
import type { ComputerScope } from "./scope";
type Scope = Pick<ComputerScope, "computers" | "self" | "viewed">;
/**
 * Which computer a new Chat is created on. The Project answers first — a Chat under another computer's Project
 * belongs on that computer, whether the row was pinned into this tab or read in that computer's own — and the
 * computer whose sidebar is on screen answers otherwise. Null is this computer, which is also the answer
 * without an account.
 *
 * An offline computer still wins the choice. Falling back to this computer because the owner is asleep would
 * create the Chat in the wrong place and say nothing about it; the composer names the sleeping computer instead
 * and waits for it.
 */
function creationComputer(scope: Scope, project?: Pick<Project, "cloud"> | null) {
  const owner = project?.cloud?.foreignSource
    ? computerOf(scope.computers, project.cloud.sourceDeviceId)
    : scope.viewed;
  return owner && owner.machineIdHash !== scope.self?.machineIdHash ? owner : null;
}
/**
 * The exact installation the draft names as `targetDeviceId`: a retained attempt's own, or the target computer's
 * online installation — a computer can carry several profiles and only a running one can take the Chat — falling
 * back to its first while it is away, and to this computer when the target is this computer.
 */
export function draftCreationTarget(input: {
  scope: Scope;
  project?: Pick<Project, "cloud"> | null;
  online(deviceId: string): boolean;
  /** A retained attempt already named a computer, and the receipt it is waiting for belongs to that one. */
  retained?: string | null;
  localDeviceId: string | null;
}) {
  if (input.retained) return input.retained;
  const owner = creationComputer(input.scope, input.project);
  if (!owner) return input.localDeviceId;
  const active = owner.installations.filter(item => item.state === "active");
  return (active.find(item => input.online(item.deviceId)) ?? active[0])?.deviceId ?? input.localDeviceId;
}
/**
 * Why that computer cannot be asked to create one right now, or null when it can. It is the sentence the Send
 * button already says for an owner that is away, so a create control and the composer behind it never disagree.
 */
export function computerCommandBlock(input: { computers: readonly CloudComputer[]; computer: CloudComputer | null; now: number; locale: string }) {
  if (!input.computer) return null;
  const copy = remoteCopy(input.locale);
  const installations = input.computer.installations;
  const block = ownerCommandBlock(copy, { computers: [...input.computers], now: input.now,
    ownerDeviceId: (installations.find(item => item.state === "active") ?? installations[0])?.deviceId ?? null });
  return block ? [block.reason, ...(block.hint ? [block.hint] : [])].join(copy.sentenceGap) : null;
}
/** The same sentence for the controls that create on whichever computer is being viewed; this computer never says it. */
export function viewedComputerBlock(scope: Pick<ComputerScope, "computers" | "viewed" | "local" | "now">, locale: string) {
  return scope.local ? null : computerCommandBlock({ computers: scope.computers, computer: scope.viewed, now: scope.now, locale });
}
