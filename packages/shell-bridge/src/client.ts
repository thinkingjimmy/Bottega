/**
 * [INPUT]: Depends on ./contract for the API and limits and ./codec for message validation.
 * [OUTPUT]: Provides getShell (memoized, null outside the native shell's top frame), createShellClient (acknowledges push taps only once a listener handled them) and readDescriptor.
 * [POS]: Page-side half of the bridge; Cloud Web consumes only this module (plus the dev mock), never host.ts.
 */
import {
  SHELL_CHANNEL_GLOBAL, SHELL_DESCRIPTOR_GLOBAL, SHELL_LIMITS, ShellError, shellCapabilities, shellMethodTimeoutMs, shellPlatforms,
  type FileTransfer, type PushOpened, type PushTap, type ShellBridge, type ShellCapability, type ShellChannel, type ShellDescriptor,
  type ShellEventName, type ShellEvents, type ShellMethod, type ShellParams, type ShellResult,
} from "./contract";
import { decodeShellMessage, encodeMessage, resultGuards } from "./codec";

type Pending = { method: ShellMethod; resolve(value: unknown): void; reject(error: ShellError): void; settle(): void };
type Listener<E extends ShellEventName> = (payload: ShellEvents[E]) => void;
export interface ShellClient extends ShellBridge { dispose(): void }

let requestCounter = 0;
const nextId = () => globalThis.crypto?.randomUUID?.() ?? `r${Date.now().toString(36)}${(requestCounter++).toString(36)}`;

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

/** Validates the injected descriptor; an unknown capability is ignored rather than trusted. */
export function readDescriptor(value: unknown): ShellDescriptor | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Partial<ShellDescriptor>;
  if (!Number.isSafeInteger(input.version) || !Number.isSafeInteger(input.generation) || (input.generation ?? -1) < 0 || !Array.isArray(input.capabilities)) return null;
  const capabilities = input.capabilities.filter((item): item is ShellCapability => shellCapabilities.includes(item as ShellCapability));
  const device = input.device;
  const validDevice = device && shellPlatforms.includes(device.platform) && typeof device.name === "string" && device.name.length > 0 &&
    device.name.length <= 40 && typeof device.appVersion === "string" && device.appVersion.length <= 100 &&
    Number.isSafeInteger(device.build) && typeof device.installationId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(device.installationId);
  return { version: input.version!, generation: input.generation!, capabilities: validDevice ? capabilities : capabilities.filter(item => item !== "device"),
    ...(validDevice ? { device: { platform: device.platform, name: device.name, appVersion: device.appVersion, build: device.build, installationId: device.installationId } } : {}) };
}

export function createShellClient(channel: ShellChannel, descriptor: ShellDescriptor): ShellClient {
  const pending = new Map<string, Pending>();
  const listeners = new Map<ShellEventName, Set<(payload: never) => unknown>>();
  const has = (capability: ShellCapability) => descriptor.capabilities.includes(capability);
  let disposed = false;

  function send(message: Parameters<typeof encodeMessage>[0]) {
    try { channel.postMessage(encodeMessage(message)); return true; } catch { return false; }
  }
  function request<M extends ShellMethod>(method: M, params: ShellParams<M>, signal?: AbortSignal): Promise<ShellResult<M>> {
    if (disposed) return Promise.reject(new ShellError("stale"));
    if (signal?.aborted) return Promise.reject(new ShellError("cancelled"));
    if (pending.size >= SHELL_LIMITS.maxPendingRequests) return Promise.reject(new ShellError("busy"));
    const id = nextId();
    return new Promise<ShellResult<M>>((resolve, reject) => {
      const abandon = (code: "timeout" | "cancelled") => {
        entry.settle();
        send({ v: 1, kind: "cancel", id, generation: descriptor.generation });
        reject(new ShellError(code));
      };
      const timer = setTimeout(() => abandon("timeout"), shellMethodTimeoutMs[method]);
      const onAbort = () => abandon("cancelled");
      const entry: Pending = {
        method, resolve: value => resolve(value as ShellResult<M>), reject,
        settle: () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); pending.delete(id); },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, entry);
      if (!send({ v: 1, kind: "request", id, generation: descriptor.generation, method, params })) {
        entry.settle(); reject(new ShellError("invalid", "shell-message-too-large"));
      }
    });
  }
  function on<E extends ShellEventName>(name: E, listener: Listener<E>) {
    const set = listeners.get(name) ?? new Set();
    listeners.set(name, set);
    set.add(listener as (payload: never) => unknown);
    return () => { set.delete(listener as (payload: never) => unknown); };
  }
  function emit<E extends ShellEventName>(name: E, payload: ShellEvents[E]) {
    for (const listener of [...(listeners.get(name) ?? [])]) {
      try { (listener as Listener<E>)(payload); } catch (error) { console.error("[shell-bridge] listener failed", error); }
    }
  }

  /* A tap no listener handled stays unacknowledged, so the shell replays it to the next subscription instead of losing it
     (e.g. the workspace is unmounted behind the unlock screen when the user taps). */
  const acked = new Set<string>();
  function openTap({ tapId, ...payload }: PushTap) {
    if (acked.has(tapId)) { void request("push.ack", { tapId }).catch(() => undefined); return; }
    let handled = false;
    for (const listener of [...(listeners.get("push.opened") ?? [])] as Array<(payload: PushOpened) => void>) {
      try { listener({ ...payload }); handled = true; } catch (error) { console.error("[shell-bridge] listener failed", error); }
    }
    if (!handled) return;
    acked.add(tapId);
    void request("push.ack", { tapId }).catch(() => undefined);
  }

  const onMessage = (event: { data: unknown }) => {
    const message = decodeShellMessage(event.data);
    if (!message) return;
    if (message.kind === "response") {
      const entry = pending.get(message.id);
      if (!entry) return;
      entry.settle();
      if (!message.ok) entry.reject(new ShellError(message.error.code, message.error.message));
      else if (!resultGuards[entry.method](message.result)) entry.reject(new ShellError("invalid", "invalid-shell-result"));
      else entry.resolve(message.result);
      return;
    }
    if (message.name === "lifecycle.back") {
      const { backId } = message.payload as ShellEvents["lifecycle.back"];
      /* Newest listener first, like a stack of open surfaces: the topmost sheet closes before the route goes back. */
      const handlers = [...(listeners.get("lifecycle.back") ?? [])].reverse() as unknown as Array<() => boolean>;
      let consumed = false;
      for (const handler of handlers) {
        try { if (handler()) { consumed = true; break; } } catch (error) { console.error("[shell-bridge] back listener failed", error); }
      }
      void request("lifecycle.backResult", { backId, consumed }).catch(() => undefined);
      return;
    }
    if (message.name === "push.opened") { openTap(message.payload as PushTap); return; }
    emit(message.name, message.payload as never);
  };
  channel.addEventListener("message", onMessage);

  async function transfer(action: "save" | "share", input: FileTransfer) {
    const { blob, signal } = input;
    if (blob.size > SHELL_LIMITS.maxFileBytes) throw new ShellError("invalid", "file-too-large");
    const { transferId } = await request("files.begin", { name: input.name, mime: input.mime || "application/octet-stream", size: blob.size, action }, signal);
    try {
      for (let offset = 0, index = 0; offset < blob.size; offset += SHELL_LIMITS.fileChunkBytes, index++) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + SHELL_LIMITS.fileChunkBytes).arrayBuffer());
        // Each chunk waits for its acknowledgement: the native side's write speed is the backpressure.
        await request("files.chunk", { transferId, index, data: toBase64(bytes) }, signal);
      }
      await request("files.commit", { transferId }, signal);
    } catch (error) {
      void request("files.cancel", { transferId }).catch(() => undefined);
      throw error;
    }
  }

  let pushSubscribers = 0;
  const bridge: ShellClient = {
    version: descriptor.version,
    ...(has("device") && descriptor.device ? { device: Object.freeze({ ...descriptor.device }) } : {}),
    ...(has("auth") ? { auth: {
      signIn: () => request("auth.signIn", {}),
      clear: async () => { await request("auth.clear", {}); },
    } } : {}),
    ...(has("secure") ? { secure: {
      wrap: input => request("secure.wrap", input),
      unwrap: input => request("secure.unwrap", input),
      remove: async keyRef => { await request("secure.remove", { keyRef }); },
    } } : {}),
    ...(has("biometrics") ? { biometrics: { capability: async () => (await request("biometrics.capability", {})).capability } } : {}),
    ...(has("push") ? { push: {
      register: async () => (await request("push.register", {})).token,
      clear: async () => { await request("push.clear", {}); },
      onTokenChanged: listener => on("push.tokenChanged", () => listener()),
      setVisibleChat: async chat => { await request("push.setVisibleChat", { chat }); },
      onOpened: listener => {
        const off = on("push.opened", listener as Listener<"push.opened">);
        if (pushSubscribers++ === 0) void request("push.subscribe", {}).then(({ pending: buffered }) => buffered.forEach(openTap), () => undefined);
        return () => { off(); pushSubscribers = Math.max(0, pushSubscribers - 1); };
      },
    } } : {}),
    ...(has("files") ? { files: { save: input => transfer("save", input), share: input => transfer("share", input) } } : {}),
    ...(has("links") ? { links: { openExternal: async (url, purpose = "web-context") => { await request("links.openExternal", { url, purpose }); } } } : {}),
    ...(has("network") ? { network: {
      state: async () => (await request("network.state", {})).state,
      onChange: listener => on("network.change", payload => listener(payload.state)),
    } } : {}),
    ...(has("lifecycle") ? { lifecycle: {
      onForeground: listener => on("lifecycle.foreground", () => listener()),
      onBackground: listener => on("lifecycle.background", () => listener()),
      onBack: listener => on("lifecycle.back", listener as unknown as Listener<"lifecycle.back">),
      ready: async () => { await request("lifecycle.ready", {}); },
    } } : {}),
    dispose() {
      if (disposed) return;
      disposed = true;
      channel.removeEventListener("message", onMessage);
      for (const [, entry] of pending) { entry.settle(); entry.reject(new ShellError("stale")); }
      listeners.clear();
    },
  };
  return bridge;
}

let memo: { value: ShellClient | null } | null = null;
/** The bridge of the native shell, or null in a normal browser, a child frame, or with a malformed injection. */
export function getShell(): ShellBridge | null {
  if (memo) return memo.value;
  memo = { value: null };
  if (typeof window === "undefined" || window.top !== window) return null;
  const scope = window as unknown as Record<string, unknown>;
  const descriptor = readDescriptor(scope[SHELL_DESCRIPTOR_GLOBAL]);
  const channel = scope[SHELL_CHANNEL_GLOBAL] as Partial<ShellChannel> | undefined;
  if (!descriptor || typeof channel?.postMessage !== "function" || typeof channel.addEventListener !== "function") return null;
  memo.value = createShellClient(channel as ShellChannel, descriptor);
  return memo.value;
}
/** Test and mock seam: forget the memoized bridge so the next getShell() re-reads the globals. */
export function resetShellForTesting() { memo?.value?.dispose(); memo = null; }
