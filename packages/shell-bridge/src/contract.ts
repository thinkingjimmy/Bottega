/**
 * [INPUT]: No runtime dependencies; plain TypeScript types and frozen constants.
 * [OUTPUT]: Provides the ShellBridge page API, the wire message shapes (including the acknowledged PushTap), the closed method/event/capability sets, per-method timeouts and the limits both the page and the native shell enforce.
 * [POS]: Single source of truth of the page ⇄ native shell contract; codec.ts validates against it, client.ts and host.ts speak it.
 */

/* Bumped only when a wire shape changes incompatibly; capabilities are still probed by presence. */
export const SHELL_BRIDGE_VERSION = 1;
/* Names the native shell registers: the message channel (a WebMessageListener object, main frame of the exact
   app origin only) and the frozen descriptor the shell injects at document start. */
export const SHELL_CHANNEL_GLOBAL = "BottegaShell";
export const SHELL_DESCRIPTOR_GLOBAL = "__bottegaShell";

export const SHELL_LIMITS = Object.freeze({
  /* One wire message, JSON text. File bytes travel in bounded chunks; a whole Blob never crosses. */
  maxMessageBytes: 262_144,
  /* Raw bytes per file chunk before base64 (base64 adds a third, still under maxMessageBytes). */
  fileChunkBytes: 131_072,
  maxFileBytes: 50_000_000,
  /* Source-image admission shared by the Web input pipeline and the Android HEIC entry (W18). */
  imageSourceMaxBytes: 50_000_000,
  imageSourceMaxPixels: 100_000_000,
  imageOutputMaxEdge: 2048,
  maxPendingRequests: 64,
});

export const shellPlatforms = ["ios", "android"] as const;
export type ShellPlatform = (typeof shellPlatforms)[number];
export interface ShellDevice {
  platform: ShellPlatform; name: string; appVersion: string; build: number; installationId: string;
}

export const shellCapabilities = ["device", "auth", "secure", "biometrics", "push", "files", "links", "network", "lifecycle"] as const;
export type ShellCapability = (typeof shellCapabilities)[number];

/** What the native shell injects before any page script runs. Contains no secret and no user data. */
export interface ShellDescriptor {
  version: number;
  /* Main-frame navigation generation; requests from an older document are dropped natively. */
  generation: number;
  capabilities: ShellCapability[];
  device?: ShellDevice;
}

export type LinkPurpose = "artifact" | "web-context" | "preview-session";
export type NetworkState = "online" | "offline" | "unknown";
export type PushKind = "settled" | "attention";
export interface PushOpened { chatId: string; kind: PushKind; turnSeq?: number }
/* On the wire a tap carries the shell's id for it: the shell keeps the tap until the page acknowledges that id. */
export interface PushTap extends PushOpened { tapId: string }
export interface VisibleChat { chatId: string; generation: number }
export interface SecureWrapInput { plaintext: string; aad: string; requireAuthentication: boolean }
export interface SecureWrapped { keyRef: string; ciphertext: string; nonce: string }
export interface SecureUnwrapInput extends SecureWrapped { aad: string }
export interface FileTransfer { name: string; mime: string; blob: Blob; signal?: AbortSignal }

/** The page-facing API. Every member is optional: absence means the shell lacks the capability. */
export interface ShellBridge {
  readonly version: number;
  readonly device?: ShellDevice;
  readonly auth?: {
    /** Native Google account picker; resolves with a short-lived ID token the page posts same-origin to sign-in/social. */
    signIn(): Promise<{ idToken: string } | { cancelled: true }>;
    clear(): Promise<void>;
  };
  readonly secure?: {
    wrap(input: SecureWrapInput): Promise<SecureWrapped>;
    unwrap(input: SecureUnwrapInput): Promise<{ plaintext: string }>;
    remove(keyRef: string): Promise<void>;
  };
  readonly biometrics?: { capability(): Promise<"none" | "available" | "enrolled"> };
  readonly push?: {
    register(): Promise<string | null>;
    clear(): Promise<void>;
    onTokenChanged(listener: () => void): () => void;
    setVisibleChat(input: VisibleChat | null): Promise<void>;
    /** Subscribe only after account and route admission. A tap is acknowledged to the shell only once a listener handled
        it without throwing; until then the shell keeps it and replays it to the next subscription (cold start, unlock). */
    onOpened(listener: (payload: PushOpened) => void): () => void;
  };
  readonly files?: { save(input: FileTransfer): Promise<void>; share(input: FileTransfer): Promise<void> };
  readonly links?: { openExternal(url: string, purpose?: LinkPurpose): Promise<void> };
  readonly network?: {
    state(): Promise<NetworkState>;
    onChange(listener: (state: Exclude<NetworkState, "unknown">) => void): () => void;
  };
  readonly lifecycle?: {
    onForeground(listener: () => void): () => void;
    onBackground(listener: () => void): () => void;
    /** Return true when the page consumed the back gesture; false (from every listener) lets the shell exit. */
    onBack(listener: () => boolean): () => void;
    /** The Web app mounted its first screen; until then the shell keeps its splash and load-failure guard armed. */
    ready(): Promise<void>;
  };
}

/* ---- wire ---- */

/* Methods and their parameter / result shapes. The codec validates params on the host and results on the page. */
export interface ShellMethods {
  "auth.signIn": { params: Record<string, never>; result: { idToken: string } | { cancelled: true } };
  "auth.clear": { params: Record<string, never>; result: null };
  "secure.wrap": { params: SecureWrapInput; result: SecureWrapped };
  "secure.unwrap": { params: SecureUnwrapInput; result: { plaintext: string } };
  "secure.remove": { params: { keyRef: string }; result: null };
  "biometrics.capability": { params: Record<string, never>; result: { capability: "none" | "available" | "enrolled" } };
  "push.register": { params: Record<string, never>; result: { token: string | null } };
  "push.clear": { params: Record<string, never>; result: null };
  "push.setVisibleChat": { params: { chat: VisibleChat | null }; result: null };
  /* Returns every unacknowledged tap; subsequent taps arrive as events. Both stay in the shell until push.ack. */
  "push.subscribe": { params: Record<string, never>; result: { pending: PushTap[] } };
  "push.ack": { params: { tapId: string }; result: null };
  "files.begin": { params: { name: string; mime: string; size: number; action: "save" | "share" }; result: { transferId: string } };
  "files.chunk": { params: { transferId: string; index: number; data: string }; result: null };
  "files.commit": { params: { transferId: string }; result: null };
  "files.cancel": { params: { transferId: string }; result: null };
  "links.openExternal": { params: { url: string; purpose: LinkPurpose }; result: null };
  "network.state": { params: Record<string, never>; result: { state: NetworkState } };
  "lifecycle.backResult": { params: { backId: string; consumed: boolean }; result: null };
  "lifecycle.ready": { params: Record<string, never>; result: null };
}
export type ShellMethod = keyof ShellMethods;
export type ShellParams<M extends ShellMethod> = ShellMethods[M]["params"];
export type ShellResult<M extends ShellMethod> = ShellMethods[M]["result"];

export const shellMethodCapability: Readonly<Record<ShellMethod, ShellCapability>> = Object.freeze({
  "auth.signIn": "auth", "auth.clear": "auth",
  "secure.wrap": "secure", "secure.unwrap": "secure", "secure.remove": "secure",
  "biometrics.capability": "biometrics",
  "push.register": "push", "push.clear": "push", "push.setVisibleChat": "push", "push.subscribe": "push", "push.ack": "push",
  "files.begin": "files", "files.chunk": "files", "files.commit": "files", "files.cancel": "files",
  "links.openExternal": "links", "network.state": "network", "lifecycle.backResult": "lifecycle", "lifecycle.ready": "lifecycle",
});
export const shellMethods = Object.keys(shellMethodCapability) as ShellMethod[];

/* User-facing native interactions (account picker, biometric prompt, share sheet) get minutes; plumbing gets seconds. */
export const shellMethodTimeoutMs: Readonly<Record<ShellMethod, number>> = Object.freeze({
  "auth.signIn": 180_000, "auth.clear": 10_000,
  "secure.wrap": 120_000, "secure.unwrap": 120_000, "secure.remove": 10_000,
  "biometrics.capability": 10_000,
  "push.register": 30_000, "push.clear": 10_000, "push.setVisibleChat": 5_000, "push.subscribe": 5_000, "push.ack": 5_000,
  "files.begin": 10_000, "files.chunk": 30_000, "files.commit": 300_000, "files.cancel": 10_000,
  "links.openExternal": 10_000, "network.state": 5_000, "lifecycle.backResult": 5_000, "lifecycle.ready": 5_000,
});

export interface ShellEvents {
  "lifecycle.foreground": Record<string, never>;
  "lifecycle.background": Record<string, never>;
  /* The page must answer with lifecycle.backResult for the same backId. */
  "lifecycle.back": { backId: string };
  "push.opened": PushTap;
  "push.tokenChanged": Record<string, never>;
  "network.change": { state: Exclude<NetworkState, "unknown"> };
}
export type ShellEventName = keyof ShellEvents;
export const shellEventNames: readonly ShellEventName[] = Object.freeze([
  "lifecycle.foreground", "lifecycle.background", "lifecycle.back", "push.opened", "push.tokenChanged", "network.change",
]);

export const shellErrorCodes = ["timeout", "cancelled", "unavailable", "denied", "failed", "stale", "invalid", "busy"] as const;
export type ShellErrorCode = (typeof shellErrorCodes)[number];

export type ShellRequestMessage = { v: 1; kind: "request"; id: string; generation: number; method: ShellMethod; params: unknown };
export type ShellCancelMessage = { v: 1; kind: "cancel"; id: string; generation: number };
export type ShellResponseMessage =
  | { v: 1; kind: "response"; id: string; ok: true; result: unknown }
  | { v: 1; kind: "response"; id: string; ok: false; error: { code: ShellErrorCode; message: string } };
export type ShellEventMessage = { v: 1; kind: "event"; name: ShellEventName; payload: unknown };
export type PageToShellMessage = ShellRequestMessage | ShellCancelMessage;
export type ShellToPageMessage = ShellResponseMessage | ShellEventMessage;

/** The transport the native shell exposes on the page (Android: a WebMessageListener JS object). */
export interface ShellChannel {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export class ShellError extends Error {
  constructor(readonly code: ShellErrorCode, message: string = code) { super(message); this.name = "ShellError"; }
}
