/**
 * [INPUT]: Depends on ./contract for methods, errors and events and ./codec for request validation.
 * [OUTPUT]: Provides createShellHost (dispatches validated page requests to native handlers, enforces capability and navigation-generation gates, cancels in-flight work and emits events) and re-exports the contract so the shell imports one entry.
 * [POS]: Shell-side half of the bridge, consumed by apps/mobile; frame and origin trust is established natively before a message reaches it.
 */
import {
  ShellError, shellMethodCapability,
  type ShellCapability, type ShellEventName, type ShellEvents, type ShellMethod, type ShellParams, type ShellResult,
} from "./contract";
import { decodePageMessage, encodeMessage, eventGuards, resultGuards } from "./codec";

export * from "./contract";

export interface ShellHandlerContext { signal: AbortSignal; generation: number }
export type ShellHandlers = { [M in ShellMethod]?: (params: ShellParams<M>, context: ShellHandlerContext) => Promise<ShellResult<M>> };
export interface ShellHostOptions {
  capabilities: readonly ShellCapability[];
  handlers: ShellHandlers;
  /** Delivers text to the main frame, but only while it still shows the given generation. */
  post(message: string, generation: number): void;
  onError?(method: ShellMethod, error: unknown): void;
}
export interface ShellHost {
  /** A message the native layer already attributed to the exact app origin's main frame at `generation`. */
  receive(raw: unknown, generation: number): void;
  emit<E extends ShellEventName>(name: E, payload: ShellEvents[E]): boolean;
  /** A new main-frame document: in-flight work of older documents is cancelled and never answered. */
  navigate(generation: number): void;
  readonly generation: number;
}

export function createShellHost(options: ShellHostOptions): ShellHost {
  let current = 0;
  const inflight = new Map<string, { controller: AbortController; generation: number }>();
  const reply = (generation: number, message: Parameters<typeof encodeMessage>[0]) => {
    if (generation !== current) return;
    try { options.post(encodeMessage(message), generation); } catch (error) { options.onError?.("network.state", error); }
  };
  async function dispatch(id: string, generation: number, method: ShellMethod, params: unknown) {
    const handler = options.handlers[method] as ((params: unknown, context: ShellHandlerContext) => Promise<unknown>) | undefined;
    if (!handler || !options.capabilities.includes(shellMethodCapability[method])) {
      reply(generation, { v: 1, kind: "response", id, ok: false, error: { code: "unavailable", message: method } });
      return;
    }
    const controller = new AbortController();
    inflight.set(id, { controller, generation });
    try {
      const result = await handler(params, { signal: controller.signal, generation });
      if (controller.signal.aborted) return;
      if (!resultGuards[method](result)) throw new Error(`invalid result for ${method}`);
      reply(generation, { v: 1, kind: "response", id, ok: true, result });
    } catch (error) {
      if (controller.signal.aborted) return;
      options.onError?.(method, error);
      // Native failures are summarized: a stack trace or platform message never reaches the page.
      const code = error instanceof ShellError ? error.code : "failed";
      reply(generation, { v: 1, kind: "response", id, ok: false, error: { code, message: error instanceof ShellError ? error.message.slice(0, 512) : "failed" } });
    } finally {
      inflight.delete(id);
    }
  }
  return {
    get generation() { return current; },
    receive(raw, generation) {
      if (generation !== current) return;
      const message = decodePageMessage(raw);
      if (!message || message.generation !== current) return;
      if (message.kind === "cancel") { inflight.get(message.id)?.controller.abort(); return; }
      if (inflight.has(message.id)) return;
      void dispatch(message.id, generation, message.method, message.params);
    },
    emit(name, payload) {
      if (!eventGuards[name](payload)) return false;
      try { options.post(encodeMessage({ v: 1, kind: "event", name, payload }), current); return true; } catch { return false; }
    },
    navigate(generation) {
      current = generation;
      for (const [id, entry] of inflight) if (entry.generation !== generation) { entry.controller.abort(); inflight.delete(id); }
    },
  };
}
