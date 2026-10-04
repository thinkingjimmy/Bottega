/**
 * [INPUT]: Depends on the Memory settings flags, the MemoryStatusSnapshot shape and the R-33 closed state / issue enums.
 * [OUTPUT]: Provides memoryFacadeState: the one state (and health issue kind) a phone shows for this computer's Memory, derived exactly as the Settings card decides its label.
 * [POS]: Shared mapping for the phone Memory facade (TASK-28); main publishes its result sealed (R-33), the phone renders it verbatim, and a test pins it to the Settings card.
 */
import type { RemoteMemoryStatus } from "@ai-chat/cloud-protocol/remote/memory-status";
import type { MemoryStatusSnapshot } from "../ipc/content/memory-ipc";

export type MemoryFacadeState = Pick<RemoteMemoryStatus, "state" | "issue">;

/**
 * Setup outranks everything (it is what the computer is doing), then the switch the person set, then health. An unavailable
 * service without a classified cause reads as unreachable: the phone can only say what the computer could not reach.
 */
export function memoryFacadeState(memory: { enabled: boolean; paused: boolean }, status: Pick<MemoryStatusSnapshot, "health" | "healthIssue" | "applyStatus">): MemoryFacadeState {
  if (status.applyStatus?.state === "pending") return { state: "setting-up", issue: null };
  if (status.applyStatus?.state === "failed") return { state: "setup-incomplete", issue: null };
  if (!memory.enabled) return { state: "off", issue: null };
  if (memory.paused) return { state: "paused", issue: null };
  if (status.health === "unavailable") return { state: "issue", issue: status.healthIssue?.kind ?? "unreachable" };
  return { state: "on", issue: null };
}
