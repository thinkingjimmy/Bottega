/**
 * [INPUT]: Depends on Zod and the public RPC envelope / capability-ref contracts
 * [OUTPUT]: Provides HOST_LAUNCH_CONTRACT (frozen at version 1; both halves refuse another at hello), HOST_GRAMMAR, HostKind, HostLaunchPlan, and the strict message schemas exchanged over the host MessagePort in both directions
 * [POS]: Wire vocabulary between main and a utility host (Provider bridge / Extension Host); every message is plain data, and every message from the utility side is validated because the utility runs package code
 */
import { z } from "zod";
import { capabilityRefSchema, rpcRequestSchema, rpcResponseSchema } from "../model/capabilities";

import { HOST_GRAMMAR } from "./contract";
export { HOST_GRAMMAR, HOST_LAUNCH_CONTRACT } from "./contract";
export const HOST_KINDS = ["provider-bridge", "extension-host"] as const;
export type HostKind = (typeof HOST_KINDS)[number];

const hostId = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
export const hostLaunchPlanSchema = z.object({
  hostId,
  kind: z.enum(HOST_KINDS),
  /** Absolute path of the approved entry module and its SHA-256; main re-hashes the file right before fork. */
  entry: z.string().min(1).max(4096).refine(value => value.startsWith("/"), "entry-must-be-absolute"),
  entrySha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Explicit environment: utilityProcess inherits all of process.env unless told otherwise. */
  env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(4096)),
}).strict();
export type HostLaunchPlan = z.infer<typeof hostLaunchPlanSchema>;

const processId = z.string().regex(/^proc_[A-Za-z0-9_-]{8,64}$/);
const invokeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const bytes = z.string().max(1_048_576);

/* ── main → utility ─────────────────────────────────────────── */
export type HostToBridge =
  | { t: "launch"; grammar: typeof HOST_GRAMMAR; contract: string; plan: HostLaunchPlan }
  | { t: "rpc-result"; response: z.infer<typeof rpcResponseSchema> }
  | { t: "invoke"; id: string; method: string; params: unknown; refs: string[] }
  | { t: "process-spawned"; id: string; ok: true; processId: string; pid: number } | { t: "process-spawned"; id: string; ok: false; error: string }
  | { t: "process-event"; processId: string; stream: "stdout" | "stderr"; data: string }
  | { t: "process-exit"; processId: string; code: number | null; signal: string | null };

/* ── utility → main (validated) ─────────────────────────────── */
export const bridgeMessageSchema = z.discriminatedUnion("t", [
  /* `contract` is the host's own launch contract; main compares it (a mismatch is refused, not parsed away). */
  z.object({ t: z.literal("hello"), grammar: z.literal(HOST_GRAMMAR), contract: z.string().max(32), hostId, pid: z.number().int().positive() }).strict(),
  /* The host refused main's launch: its own contract (named here) is not the one main launched under. */
  z.object({ t: z.literal("refused"), reason: z.literal("contract"), contract: z.string().max(32) }).strict(),
  z.object({ t: z.literal("rpc"), request: rpcRequestSchema }).strict(),
  z.object({ t: z.literal("invoke-result"), id: invokeId, ok: z.boolean(), result: z.unknown().optional(), error: z.string().max(1024).optional() }).strict(),
  /** Every process belongs to the principal behind an execution ref; the bridge itself never spawns. */
  z.object({ t: z.literal("process-spawn"), id: invokeId, ref: capabilityRefSchema, command: z.string().min(1).max(4096),
    args: z.array(z.string().max(65_536)).max(256), cwd: z.string().min(1).max(4096).optional(),
    env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/), z.string().max(65_536)).optional(),
    /** Start through the guardian under the custody journal (a Provider turn process) instead of as a plain descendant. */
    custody: z.boolean().optional(),
    /** Spawn the launch main sealed on the execution ref instead of the command given here (Provider turns). */
    plan: z.boolean().optional() }).strict(),
  z.object({ t: z.literal("process-stdin"), processId, data: bytes.optional(), end: z.boolean().optional() }).strict(),
  z.object({ t: z.literal("process-kill"), processId }).strict(),
]);
export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;
