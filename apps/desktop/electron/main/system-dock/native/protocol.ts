/**
 * [INPUT]: Depends on zod only.
 * [OUTPUT]: Provides the versioned JSON-line protocol between main and the `system-dock-bridge` helper: request ops, strict result schemas, pushed events, and the recovery-agent XPC handshake payloads relayed through the helper.
 * [POS]: system-dock/native wire contract; the Objective-C helper (resources/system-dock/native/bridge.m) implements exactly these ops. Paths may cross this pipe; they never reach a renderer.
 */

import { z } from "zod";

export const BRIDGE_PROTOCOL_VERSION = 1;
/** Bounds shared with the helper: a line never exceeds this many bytes, a request never outlives its timeout. */
export const BRIDGE_LIMITS = { lineBytes: 4 * 1024 * 1024, defaultTimeoutMs: 5_000, iconBatch: 32, iconSize: 64 } as const;

const pid = z.number().int().positive();
const path = z.string().min(1).max(4096);
const bundleId = z.string().min(1).max(255);

export const helloSchema = z.object({ version: z.literal(BRIDGE_PROTOCOL_VERSION), osVersion: z.string().max(32), arch: z.string().max(16),
  parentPid: pid, parentStartedAt: z.number().int().nonnegative(), uid: z.number().int().nonnegative(), axTrusted: z.boolean() }).strict();
export const runningAppSchema = z.object({ pid, bundleIdentifier: bundleId.nullable(), name: z.string().max(512), path: path.nullable(),
  activationPolicy: z.enum(["regular", "accessory", "prohibited"]), finishedLaunching: z.boolean(), active: z.boolean(), hidden: z.boolean() }).strict();
export const runningAppsSchema = z.array(runningAppSchema).max(512);
export const resolvedAppSchema = z.object({ path, bundleIdentifier: bundleId.nullable(), name: z.string().max(512), version: z.string().max(128).nullable(),
  copies: z.array(path).max(16) }).strict();
export const prefValueSchema = z.object({ present: z.boolean(), type: z.enum(["bool", "real", "int", "string", "other", "missing"]),
  value: z.union([z.boolean(), z.number(), z.string(), z.null()]), forced: z.boolean() }).strict();
export const DOCK_PREF_KEYS = ["autohide", "autohide-delay"] as const;
export type DockPrefKey = (typeof DOCK_PREF_KEYS)[number];
export const dockPrefsSchema = z.object({ autohide: prefValueSchema, "autohide-delay": prefValueSchema }).strict();
export type PrefValue = z.infer<typeof prefValueSchema>;
export const persistentTileSchema = z.object({ section: z.enum(["apps", "others"]), tileType: z.string().max(64), label: z.string().max(512).nullable(),
  bundleIdentifier: bundleId.nullable(), path: path.nullable(), url: z.string().max(4096).nullable() }).strict();
export const persistentTilesSchema = z.object({ status: z.enum(["ok", "missing", "managed", "unavailable"]), tiles: z.array(persistentTileSchema).max(256) }).strict();
export const trashStateSchema = z.object({ state: z.enum(["empty", "full", "unknown"]), volumes: z.array(z.object({ path, count: z.number().int().nonnegative().nullable(),
  error: z.string().max(64).nullable() }).strict()).max(64) }).strict();
/** Decoded AEDeterminePermissionToAutomateTarget: noErr → granted, -1744 → needs-prompt, -1743 → denied, -600 → Finder not running. */
export const automationSchema = z.object({ status: z.enum(["granted", "needs-prompt", "denied", "unavailable"]), code: z.number().int() }).strict();
export const emptyTrashSchema = z.object({ result: z.enum(["emptied", "failed", "denied", "timeout", "cancelled"]), code: z.number().int() }).strict();
export const unminimizeSchema = z.object({ trusted: z.boolean(), restored: z.number().int().nonnegative(), windows: z.number().int().nonnegative() }).strict();
export const agentReplySchema = z.object({ ok: z.boolean(), agentPid: pid.nullable(), code: z.enum(["ok", "unreachable", "timeout", "rejected", "stale-epoch", "owned-elsewhere", "exiting", "invalid"]),
  observedOwner: z.boolean(), leaseExpiresAt: z.number().int().nonnegative().nullable() }).strict();

/** Everything main may ask; the helper rejects any other `op` with `error: "unknown-op"`. */
export type BridgeRequest =
  | { op: "hello" }
  | { op: "running-apps" }
  | { op: "process-info"; pid: number }
  | { op: "resolve-app"; bundleIdentifier?: string; path?: string }
  | { op: "installed-apps" }
  | { op: "icons"; paths: string[]; size: number }
  | { op: "launch"; path: string; activate: true }
  | { op: "activate-pid"; pid: number }
  | { op: "ax-status"; prompt: boolean }
  | { op: "unminimize"; pid: number }
  | { op: "dock-prefs-read" }
  | { op: "dock-prefs-write"; key: DockPrefKey; action: "set"; type: "bool" | "real" | "int"; value: boolean | number }
  | { op: "dock-prefs-write"; key: DockPrefKey; action: "delete" }
  | { op: "dock-reload" }
  | { op: "dock-persistent-apps" }
  | { op: "trash-state" }
  | { op: "automation-status"; prompt: boolean }
  | { op: "empty-trash"; timeoutMs: number }
  | { op: "finder-activate" }
  | { op: "watch-trash"; enabled: boolean }
  | { op: "agent-call"; method: "prepare" | "renew" | "release" | "status"; machService: string; payload: AgentPayload; timeoutMs: number };
/** Payload relayed verbatim to the recovery agent over XPC (JSON string); the agent re-validates the peer and every field. */
export type AgentPayload = { operationId: string; ownershipEpoch: number; ownerPid: number; ownerStartedAt: number; installation: string; nonce: string; journalPath: string };

export const bridgeResults = {
  hello: helloSchema,
  "running-apps": runningAppsSchema,
  /** Liveness with start time (ms) so a reused PID never impersonates a dead owner (INV-05). */
  "process-info": z.object({ alive: z.boolean(), startedAt: z.number().int().nonnegative().nullable() }).strict(),
  "resolve-app": resolvedAppSchema.nullable(),
  /** Controlled enumeration for add candidates only: first level of /Applications, /Applications/Utilities, /System/Applications(+Utilities), ~/Applications. */
  "installed-apps": z.array(z.object({ path, bundleIdentifier: bundleId.nullable(), name: z.string().max(512) }).strict()).max(2048),
  icons: z.record(z.string(), z.string().max(512 * 1024)),
  launch: z.object({ pid: pid.nullable() }).strict(),
  /** NSRunningApplication activation without a reopen event: returns focus to the app that had it (INV-09). */
  "activate-pid": z.object({ activated: z.boolean() }).strict(),
  "ax-status": z.object({ trusted: z.boolean() }).strict(),
  unminimize: unminimizeSchema,
  "dock-prefs-read": dockPrefsSchema,
  "dock-prefs-write": dockPrefsSchema,
  "dock-reload": z.object({ reloaded: z.boolean() }).strict(),
  "dock-persistent-apps": persistentTilesSchema,
  "trash-state": trashStateSchema,
  "automation-status": automationSchema,
  "empty-trash": emptyTrashSchema,
  "finder-activate": z.object({ activated: z.boolean() }).strict(),
  "watch-trash": z.object({ watching: z.boolean() }).strict(),
  "agent-call": agentReplySchema,
} as const satisfies Record<BridgeRequest["op"], z.ZodType>;
export type BridgeResult<Op extends BridgeRequest["op"]> = z.infer<(typeof bridgeResults)[Op]>;

/** Pushed without a request id; bounded and coalesced by the helper. */
export const bridgeEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("running"), apps: runningAppsSchema }).strict(),
  z.object({ event: z.literal("trash"), state: trashStateSchema }).strict(),
  z.object({ event: z.literal("dock-prefs"), prefs: dockPrefsSchema }).strict(),
]);
export type BridgeEvent = z.infer<typeof bridgeEventSchema>;
export const bridgeResponseSchema = z.union([
  z.object({ id: z.number().int().positive(), ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ id: z.number().int().positive(), ok: z.literal(false), error: z.string().max(64) }).strict(),
]);
export type RunningApp = z.infer<typeof runningAppSchema>;
export type ResolvedApp = z.infer<typeof resolvedAppSchema>;
export type PersistentTile = z.infer<typeof persistentTileSchema>;
export type TrashNative = z.infer<typeof trashStateSchema>;
export type AgentReply = z.infer<typeof agentReplySchema>;
