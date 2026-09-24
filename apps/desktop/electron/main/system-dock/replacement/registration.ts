/**
 * [INPUT]: Depends on Electron's app.get/setLoginItemSettings ServiceManagement wrapper for type 'agentService' with a main-fixed serviceName.
 * [OUTPUT]: Provides RecoveryRegistration: the four-state recovery agent registration fact (not-registered | enabled | requires-approval | not-found, unknown rejected), register/unregister with bounded call records, and an unsupported adapter for development and non-replacement builds.
 * [POS]: system-dock/replacement system-write boundary for the dedicated LaunchAgent only; it never reads or writes the full App's openAtLogin (C14), which stays with presence/platform.
 */

import { RECOVERY_REGISTRATION, type RecoveryRegistration } from "../../../../shared/system-dock/local-state";

export type LoginItemApi = {
  getLoginItemSettings(options: { type: "agentService"; serviceName: string }): { status?: string };
  setLoginItemSettings(settings: { type: "agentService"; serviceName: string; openAtLogin: boolean }): void;
};
export type RegistrationPort = {
  supported: boolean;
  read(): RecoveryRegistration | "unsupported";
  register(): RecoveryRegistration | "unsupported";
  unregister(): RecoveryRegistration | "unsupported";
  calls(): readonly { operation: "read" | "register" | "unregister"; result: string }[];
};
export class RegistrationError extends Error {
  constructor(readonly status: string) { super(`SYSTEM_DOCK_REGISTRATION_${status.toUpperCase()}`); this.name = "RegistrationError"; }
}

export function createRegistration(api: LoginItemApi | null, serviceName: string | null): RegistrationPort {
  const calls: { operation: "read" | "register" | "unregister"; result: string }[] = [];
  const record = (operation: "read" | "register" | "unregister", result: string) => { calls.push({ operation, result }); if (calls.length > 64) calls.shift(); };
  if (!api || !serviceName) return { supported: false, read: () => "unsupported", register: () => "unsupported", unregister: () => "unsupported", calls: () => [...calls] };
  const read = (): RecoveryRegistration => {
    const status = api.getLoginItemSettings({ type: "agentService", serviceName }).status ?? "";
    // An OS value outside the documented four is a fact we do not understand; never coerce it.
    if (!(RECOVERY_REGISTRATION as readonly string[]).includes(status)) throw new RegistrationError(status || "missing");
    return status as RecoveryRegistration;
  };
  return {
    supported: true,
    read() { const value = read(); record("read", value); return value; },
    register() {
      // A service the user disabled stays disabled: re-registering would bypass their choice (INV-02).
      const before = read();
      if (before === "enabled" || before === "requires-approval") { record("register", `kept-${before}`); return before; }
      api.setLoginItemSettings({ type: "agentService", serviceName, openAtLogin: true });
      const after = read(); record("register", after); return after;
    },
    unregister() {
      const before = read();
      if (before === "not-registered" || before === "not-found") { record("unregister", `kept-${before}`); return before; }
      api.setLoginItemSettings({ type: "agentService", serviceName, openAtLogin: false });
      const after = read(); record("unregister", after); return after;
    },
    calls: () => [...calls],
  };
}
