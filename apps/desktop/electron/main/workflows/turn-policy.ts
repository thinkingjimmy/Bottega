/**
 * [INPUT]: Depends on Workflow config resource references and builtin tool access contracts.
 * [OUTPUT]: Provides Main-owned workflow turn policies, filesystem/Base caps, frozen Skill/MCP selections and recorded command exit codes.
 * [POS]: In-memory execution authority set by the executor and consumed by turn preparation and tool issuance.
 */
import type { FrozenAgentResources } from "@ai-chat/cloud-protocol/agent-config/payload";
/** Every workflow agent turn owes one report; planning and review also run read-only (no workspace writes, read built-ins only). */
export type WorkflowTurnPolicy = Readonly<{ readOnly: boolean; /** Host-granted roots readable but never writable, e.g. the run's evidence (W16). */ readOnlyRoots?: readonly string[];
  /** Review only: the same run's development Chat, the one Chat `read_step_history` reads (TASK-18). */ historyChatId?: string;
  /** The frozen config's effective Base scope (AGT-06 (a)); absent means read. */ base?: "read" | "read-write";
  resources?: FrozenAgentResources;
  workflowMemoryRead?: boolean;
  recallQuery?: string;
  admittedAt?: number;
  /** The configuration asked for no network; admission let only a Provider measured to enforce it through (TASK-12). */ networkOff?: boolean }>;
const policies = new Map<string, WorkflowTurnPolicy>();

/** Set before the turn is submitted, cleared once it settles. */
export function setWorkflowTurnPolicy(requestId: string, policy: WorkflowTurnPolicy) { policies.set(requestId, policy); }
export function workflowTurnPolicyFor(requestId: string | undefined) { return requestId ? policies.get(requestId) ?? null : null; }
/** Only the workflow executor can narrow a turn's fence, through this main-only policy (W2); an ordinary Chat turn gets nothing here. */
export function workflowTurnFence(requestId: string | undefined): { mode?: "read-only"; network?: "off" } {
  const policy = workflowTurnPolicyFor(requestId);
  return { ...(policy?.readOnly ? { mode: "read-only" as const } : {}), ...(policy?.networkOff ? { network: "off" as const } : {}) };
}
export function clearWorkflowTurnPolicy(requestId: string) { policies.delete(requestId); commandExits.delete(requestId); }
/* The exact exit codes a workflow turn's commands reported (TASK-18), by item; only workflow turns are recorded, and only in memory. */
const commandExits = new Map<string, Map<string, number>>();
export function recordWorkflowCommandExit(requestId: string, itemId: string, exitCode: number) {
  if (!policies.has(requestId)) return;
  commandExits.set(requestId, (commandExits.get(requestId) ?? new Map()).set(itemId, exitCode));
}
export function workflowCommandExits(requestId: string): ReadonlyMap<string, number> { return commandExits.get(requestId) ?? new Map(); }
/** A read-only step, or one whose frozen scope does not name Base writes, gets at most read built-ins, whatever the runtime could do (W2, AGT-06). */
export function workflowCappedBuiltinTools(tools: "none" | "read" | "mutate", requestId: string | undefined) {
  const policy = workflowTurnPolicyFor(requestId);
  return tools === "mutate" && policy && (policy.readOnly || policy.base !== "read-write") ? "read" as const : tools;
}
