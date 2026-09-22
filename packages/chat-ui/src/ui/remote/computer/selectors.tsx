/**
 * [INPUT]: Depends on confirmed target capabilities and remote interaction copy.
 * [OUTPUT]: Provides targetReason — why an installation cannot take work right now, with distinct pending and unbound Project facts.
 * [POS]: The computer surface's one rule about a single target; a Chat belongs to the computer it was created on, so nothing here picks or moves one.
 */
import type { RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteCopy } from "../../../i18n/remote";
export function targetReason(target: RemoteTarget, protocol: number, copy: RemoteCopy) {
  if (!target.online) return copy.offline;
  if (target.protocolVersion !== protocol) return copy.update;
  if (target.reason === "local-facts-pending") return copy.projectPending;
  if (target.projectBound === false) return copy.projectUnbound;
  return null;
}
