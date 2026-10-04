/**
 * [INPUT]: Depends only on shared turn/IPC types (type-only imports)
 * [OUTPUT]: Provides the Provider bridge message vocabulary: providerHostId, PROVIDER_TURN_OPERATIONS, BridgeTurnStart (what main hands the bridge to start a turn, including the session `_meta` main computed), BridgeTurnEvent (ordered turn → main notifications, one per AcpTurn callback) BridgeTurnRequest (the awaited turn → main calls, including `mcp-servers`: an acp-transport session's servers with their tokens, answered at its creation), the headless start/outcome and BridgeQuotaAnswer (a quota operation's result or finite reason)
 * [POS]: Imported by both halves — main's BridgedAcpTurn/ProviderBridgeRuntime and the bridge entry — so the boundary is one typed list; everything here is plain JSON by construction
 */
import type { AgentSendPayload, SessionRef } from "../../../../shared/ipc/agent/agent-ipc";
import type { PersistedSubagent } from "../../../../shared/ipc/content/chats-ipc";
import type { NativeSessionHint } from "../../library/sessions/boundary";
import type { QuotaReason } from "../../../../shared/usage-limits/types";
import type { QuotaReadResult } from "../../usage-limits/readers/common";

export const providerHostId = (providerId: string) => `provider-${providerId}`;
export const PROVIDER_TURN_OPERATIONS = Object.freeze({ events: "provider.turn.events", request: "provider.turn.request" });

/** Callbacks that are plain notifications: the bridge sends them in order, main applies them in order. */
export const NOTIFY_CALLBACKS = ["onConfigOptionUpdate", "onItemDelta", "onItem", "onItemRemoved", "onSubagentUpdate", "onSubagentItem",
  "onSubagentItemDelta", "onApproval", "onApprovalClosed", "onUserInput", "onUserInputClosed", "onThirdPartyMcpProtocol", "onPolicyViolation",
  "onTerminal", "onProcessError"] as const;
export type NotifyCallback = (typeof NOTIFY_CALLBACKS)[number];

/**
 * What the bridge needs to run the turn and nothing more. The launch (command, arguments, cwd, environment with MCP
 * secrets, Seatbelt profile) is not here: main seals it on the execution ref and the bridge can only ask to spawn it.
 * Third-party MCP entries and the built-in server spec arrive with their secret values blanked.
 */
export type BridgeTurnStart = Readonly<{
  turnKey: string;
  payload: AgentSendPayload;
  input: unknown[];
  runtime: { executable: string; path: string; version: string };
  workspace: string;
  artifactDirectory?: string;
  productContext?: string;
  sensitive?: { kind: string; text: string; count: number; bytes: number };
  serverFactBinding?: unknown;
  recovery?: { candidate: NativeSessionHint | null };
  hooks: { sessionPrompt: boolean; authority: boolean };
  builtinMcp?: { server: { name: string; command: string; args: string[]; env: Record<string, string> } };
  thirdPartyMcpPlan?: unknown;
  /** The session `_meta` main computed (Claude's sandbox settings, tools and plugins: its fence); the bridge sends it unchanged (D1). */
  sessionMeta?: Record<string, unknown>;
  /** The Chat's registry as persisted; the bridge mirrors it and replays every upsert to main in order. */
  subagents: Record<string, PersistedSubagent>;
  trace: boolean;
}>;

export type BridgeTurnEvent =
  | { k: "cb"; name: NotifyCallback; args: unknown[] }
  | { k: "subagent-meta"; input: unknown }
  | { k: "trace-wire"; direction: string; line: string }
  | { k: "trace-mapped"; event: unknown }
  | { k: "process"; pid: number | null; steering: boolean }
  /* A headless run's live item (TASK-11 D8), in the order the shared output reader produced it. */
  | { k: "headless-event"; event: unknown };

export type BridgeTurnRequest =
  | { k: "thread"; session: SessionRef }
  | { k: "session-prompt"; sessionId: string; texts: unknown }
  | { k: "authority" }
  | { k: "builtin-ready" }
  | { k: "recovery-complete"; outcome: unknown }
  /* The bridge's prompt asks main to consume the turn's contribution lease and waits for its validation (G9). */
  | { k: "contribution-consume" }
  /* acp MCP transport (Kimi, Claude): the session's servers, tokens included, answered by main at each session creation (D2). */
  | { k: "mcp-servers" }
  /* A headless run asks for its stdin once main has recorded the process (the job's onProcessGroup hook), as the in-process order is. */
  | { k: "headless-stdin" };

/** What the bridge needs to run a headless job whose launch main sealed: which parser, and nothing that decides or fences (D8). */
export type BridgeHeadlessStart = Readonly<{ turnKey: string; backend: string; wantsJson: boolean }>;

/** A finished headless run, as the shared reader saw it; the stderr tail is raw, main redacts it with the environment it holds. */
export type BridgeHeadlessOutcome = Readonly<{ state: { text: string; json?: unknown; error?: string }; limitError: string | null;
  stderrTail: string; code: number | null; signal: string | null; spawnError: string | null }>;

/** A bridged quota operation's answer (D9): the normalized result, or the finite reason main's reader would have thrown. */
export type BridgeQuotaAnswer = { ok: true; result?: QuotaReadResult } | { ok: false; reason: QuotaReason; retryAfterMs?: number };

/** Main's half of any work a bridge runs for it (a turn, a headless run, a quota channel): the turn table, bridge loss and idle stop see only this. */
export type BridgedWork = { readonly providerId: string; readonly turnKey: string;
  apply(event: BridgeTurnEvent): void; request(request: BridgeTurnRequest): Promise<unknown>; bridgeLost(reason: string): void };
