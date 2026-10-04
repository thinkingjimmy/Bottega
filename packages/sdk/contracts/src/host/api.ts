/**
 * [INPUT]: Depends on the host launch plan type in protocol.ts only.
 * [OUTPUT]: Provides HostApi (what a package's activate() receives: named operations with capability refs, and processes by message) and HostProcess.
 * [POS]: The package-facing half of the host protocol; the desktop host entry implements it inside the utility process, and @bottega/sdk types a package against it. Types only.
 */
import type { HostLaunchPlan } from "./protocol";

export type HostProcess = Readonly<{ processId: string; pid: number; write(data: string): void; end(): void; kill(): void;
  onOutput(listener: (stream: "stdout" | "stderr", data: string) => void): void; exited: Promise<{ code: number | null; signal: string | null }> }>;
export type HostApi = Readonly<{
  hostId: string;
  kind: HostLaunchPlan["kind"];
  /** Calls a host operation; the first ref must be the execution ref that names the principal. */
  call(operation: string, input: unknown, refs: string[]): Promise<unknown>;
  /** `plan: true`: spawn the launch main sealed on this execution ref (always in custody); command and args are ignored. */
  spawn(ref: string, command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; custody?: boolean; plan?: boolean }): Promise<HostProcess>;
}>;
/** A package's handlers: method name → handler over (params, refs). */
export type HostHandler = (params: unknown, refs: string[]) => unknown;
