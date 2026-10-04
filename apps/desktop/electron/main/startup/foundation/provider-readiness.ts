/**
 * [INPUT]: Depends on Provider plugin/runtime/auth snapshots and bounded refresh/scoped-auth ports.
 * [OUTPUT]: Provides createProviderReadiness with distinct installation, version and authentication refusals; OpenCode route readiness does not claim global sign-in.
 * [POS]: Workflow admission adapter shared by setup, execution and report repair.
 */
import type { ProviderReadiness } from "../../workflows/runtime/turn/effective-config";

/** Long enough for a fresh authentication check to answer, short enough that setup never hangs on one that will not. */
const AUTH_WAIT_MS = 15_000;
type Info = { runtimeStatus: string; authStatus: string; availability?: { authUnknownReason?: string } } | null;

export function createProviderReadiness(ports: { enabled(providerId: string): boolean; isAgent(providerId: string): boolean;
  refresh(providerId: string): Promise<unknown>; info(providerId: string): Info; waitMs?: number;
  checkScopedAuth?(providerId: string, signal: AbortSignal): Promise<{ status: string }> }) {
  const checks = new Map<string, Promise<{ status: string }>>();
  return async (providerId: string): Promise<ProviderReadiness> => {
    if (!ports.enabled(providerId)) return "plugin-disabled";
    if (!ports.isAgent(providerId)) return "ready";
    /* The refresh is awaited, bounded: a stale snapshot is never the answer when a check could still give one. */
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([ports.refresh(providerId).then(() => "answered" as const, () => "answered" as const),
      new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), ports.waitMs ?? AUTH_WAIT_MS); })]);
    clearTimeout(timer);
    const info = ports.info(providerId);
    if (info?.runtimeStatus === "unsupported") return "provider-version-too-old";
    if (info?.runtimeStatus === "missing") return "provider-not-installed";
    if (info?.runtimeStatus === "error") return "provider-auth-error";
    if (info?.authStatus === "authenticated") return "ready";
    /* A custom route's official answer is no evidence; its role runs like any turn on that route (TASK-13 E). */
    if (info?.authStatus === "unknown" && info.availability?.authUnknownReason === "custom-route") return "ready";
    /* OpenCode authenticates per model route. A successful ACP handshake permits a turn, without asserting global sign-in. */
    if (providerId === "opencode" && info?.runtimeStatus === "installed" && info.authStatus === "unknown"
      && info.availability?.authUnknownReason === "provider-scoped") return "ready";
    if (providerId === "kimi" && info?.runtimeStatus === "installed" && info.authStatus === "unknown"
      && info.availability?.authUnknownReason === "provider-scoped" && ports.checkScopedAuth) {
      /* The registry cannot advertise a workspace-scoped credential globally. Use Kimi's existing model-free auth probe
         for this admission only; its positive result never changes the account-wide sign-in indicator. */
      let check = checks.get(providerId);
      if (!check) {
        const signal = AbortSignal.timeout(ports.waitMs ?? AUTH_WAIT_MS);
        check = Promise.race([ports.checkScopedAuth(providerId, signal), new Promise<{ status: string }>(resolve => {
          signal.addEventListener("abort", () => resolve({ status: "timeout" }), { once: true });
        })]).catch(() => ({ status: "error" })).finally(() => checks.delete(providerId));
        checks.set(providerId, check);
      }
      const auth = await check;
      return auth.status === "authenticated" ? "ready" : auth.status === "unauthenticated" ? "provider-signed-out"
        : auth.status === "timeout" ? "provider-auth-timeout" : auth.status === "error" ? "provider-auth-error" : "provider-auth-unknown";
    }
    if (info?.authStatus === "unauthenticated") return "provider-signed-out";
    if (outcome === "timeout") return "provider-auth-timeout";
    if (info?.authStatus === "checking") return "provider-auth-checking";
    return info?.authStatus === "error" ? "provider-auth-error" : "provider-auth-unknown";
  };
}
