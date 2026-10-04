/**
 * [INPUT]: Depends on the Codex environment, the bridged quota channel and the reader's one-shot adapter.
 * [OUTPUT]: Provides codexQuotaLaunch (the app-server process main launches sealed for host custody) and codexQuota, Codex's
 *           QuotaHook: bridged, read once per call — no warm channel, since keeping the process saves only 0.5 s.
 * [POS]: Codex's half of TASK-13 B, carried by codexBackend; the bridge speaks the protocol (usage-limits/readers/exchange.ts).
 */
import type { ResolvedRuntime } from "../../backends/types";
import { bridgedQuotaChannel } from "../host/turns/bridged-quota";
import { readOnce, type QuotaHook } from "../../usage-limits/readers/common";
import { codexEnvironment } from "./environment";

export const codexQuotaLaunch = (runtime: ResolvedRuntime, cwd: string) => ({ command: runtime.executable,
  args: ["-c", "analytics.enabled=false", "app-server", "--listen", "stdio://"], cwd, env: codexEnvironment(runtime) });

export const codexQuota: QuotaHook = { kind: "bridged", read: readOnce(bridgedQuotaChannel(codexQuotaLaunch)) };
