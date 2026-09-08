/**
 * [INPUT]: Depends on Immutable platform/packaging facts and a lazily constructed system login port.
 * [OUTPUT]: Provides login adapter selection, effective state projection, and bounded readonly call/write observations.
 * [POS]: Presence system-write boundary; unpackaged and unsupported builds cannot construct the real adapter.
 */

import type { EffectivePresence, PresenceObservation } from "../../../../shared/presence-ipc";

export type LoginFact = { enabled: boolean; wasOpenedAtLogin: boolean; approval: boolean };
export type LoginItemPort = {
  kind: PresenceObservation["adapter"];
  read(): LoginFact;
  write(enabled: boolean): void;
  observation(): PresenceObservation;
};
export function selectLoginItem(input: {
  supported: boolean; packaged: boolean;
  real: () => Pick<LoginItemPort, "read" | "write">;
}): LoginItemPort {
  // Platform and packaging are immutable facts; no environment variable or injection overrides them.
  const kind = !input.supported ? "unsupported" : input.packaged ? "macos" : "recording";
  const real = kind === "macos" ? input.real() : null;
  let systemWrites = 0;
  let lastRead: LoginFact | null = null;
  const calls: Array<{ operation: "read" | "write"; enabled?: boolean }> = [];
  const record = (call: typeof calls[number]) => { calls.push(call); if (calls.length > 64) calls.shift(); };
  return {
    kind,
    read() {
      record({ operation: "read" });
      lastRead = real?.read() ?? { enabled: false, wasOpenedAtLogin: false, approval: false };
      return { ...lastRead };
    },
    write(enabled) {
      if (!real) throw new Error("LOGIN_ITEM_UNSUPPORTED");
      systemWrites += 1;
      record({ operation: "write", enabled });
      real.write(enabled);
    },
    observation: () => ({ adapter: kind, systemWrites, lastRead: lastRead ? { ...lastRead } : null, calls: calls.map((call) => ({ ...call })) }),
  };
}
export function loginProjection(port: LoginItemPort, desired: boolean, fact: LoginFact): EffectivePresence {
  if (port.kind !== "macos") return { status: "unsupported", reason: port.kind === "recording" ? "development" : "platform" };
  if (fact.approval) return { status: "blocked", reason: "approval" };
  if (fact.enabled) return { status: "enabled", reason: null };
  return desired ? { status: "blocked", reason: "system-disabled" } : { status: "disabled", reason: null };
}
