/**
 * [INPUT]: Depends on descriptor contracts, filesystem identities and bounded diagnostics.
 * [OUTPUT]: Provides registry snapshot types, identity comparison and cancellation helpers.
 * [POS]: Internal runtime discovery primitives shared by the availability registry.
 */
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { sep } from "node:path";
import type { AgentBackendId, BackendAuthStatus, BackendCapabilities } from "../../../../shared/agent-ipc";
import type { AgentRuntime, BackendDescriptor, ResolvedRuntime } from "../types";
import { runtimeVersionAsync } from "../runtime-probe";
import type { AgentProcessLease } from "../../agent-process-supervisor";
export type DisabledCapabilities = BackendCapabilities & {
  resume: false;
  permissionModes: [];
  modelOptions: "none";
  imageInput: false;
  planMode: false;
  headless: [];
  maintenance: false;
  builtinTools: "none";
};

export const DISABLED_CAPABILITIES: DisabledCapabilities = {
  resume: false,
  permissionModes: [],
  modelOptions: "none",
  imageInput: false,
  planMode: false,
  headless: [],
  maintenance: false,
  builtinTools: "none",
};

export type RuntimeIdentity = {
  realpath: string;
  dev: bigint;
  ino: bigint;
  mtimeMs: number;
  size: number;
};

export type MissingSnapshot = {
  runtimeStatus: "unknown" | "missing" | "error";
  runtime?: never;
  capabilities: BackendCapabilities;
  authStatus: "unknown" | "error";
  generation: number;
  reason?: string;
};

export type PresentSnapshot = {
  runtimeStatus: "unsupported" | "installed";
  runtime: ResolvedRuntime;
  capabilities: BackendCapabilities;
  authStatus: BackendAuthStatus;
  generation: number;
  reason?: string;
};

export type BackendRuntimeSnapshot = (MissingSnapshot | PresentSnapshot) & { availability?: import("../../../../shared/agent-availability/types").AvailabilityFacts };

export type StoredSnapshot = {
  snapshot: BackendRuntimeSnapshot;
  identity?: RuntimeIdentity;
};

export type CandidateRuntime = {
  runtime: ResolvedRuntime;
  identity: RuntimeIdentity;
  capabilities: BackendCapabilities;
};

export type InspectedCandidate =
  | { kind: "unusable"; diagnostic: string }
  | ({ kind: "installed" } & CandidateRuntime)
  | ({
      kind: "unsupported";
      reason: string;
      diagnostic: string;
    } & CandidateRuntime);

const MAX_CANDIDATE_DIAGNOSTICS = 12;
const MAX_CANDIDATE_DIAGNOSTIC_LENGTH = 240;

function compactDiagnostic(value: string) {
  const home = homedir();
  const privateValue = home ? value.replaceAll(home, "~") : value;
  const compact = privateValue.replace(/\s+/g, " ").trim();
  return compact.length <= MAX_CANDIDATE_DIAGNOSTIC_LENGTH
    ? compact
    : `${compact.slice(0, MAX_CANDIDATE_DIAGNOSTIC_LENGTH - 1)}…`;
}

function displayExecutable(executable: string) {
  const home = homedir();
  return home && executable.startsWith(`${home}${sep}`)
    ? `~${executable.slice(home.length)}`
    : executable;
}

export function candidateDiagnostic(candidate: AgentRuntime, detail: string) {
  return compactDiagnostic(`${displayExecutable(candidate.executable)}：${detail}`);
}

export function summarizeCandidateDiagnostics(diagnostics: readonly string[]) {
  const visible = diagnostics.slice(0, MAX_CANDIDATE_DIAGNOSTICS);
  const omitted = diagnostics.length - visible.length;
  return `候选诊断：${visible.join("；")}${
    omitted > 0 ? `；另有 ${omitted} 个候选已省略` : ""
  }`;
}

export type RegistryDependencies = {
  now?(): number;
  descriptorFor(id: AgentBackendId): BackendDescriptor;
  version?(
    runtime: Parameters<typeof runtimeVersionAsync>[0],
    signal?: AbortSignal
  ): Promise<string | undefined>;
  identity?(
    executable: string,
    signal?: AbortSignal
  ): Promise<RuntimeIdentity>;
  acquireLease?(
    backend: AgentBackendId,
    kind: "background",
    signal?: AbortSignal
  ): Promise<AgentProcessLease>;
};

export async function executableIdentity(executable: string): Promise<RuntimeIdentity> {
  const canonical = await realpath(executable);
  const metadata = await stat(canonical, { bigint: true });
  return {
    realpath: canonical,
    dev: metadata.dev,
    ino: metadata.ino,
    mtimeMs: Number(metadata.mtimeMs),
    size: Number(metadata.size),
  };
}

export function sameIdentity(left: RuntimeIdentity, right: RuntimeIdentity) {
  return (
    left.realpath === right.realpath &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

export function waitForSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const settle = <TValue>(
      next: (value: TValue) => void,
      value: TValue
    ) => {
      signal.removeEventListener("abort", abort);
      next(value);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => settle(resolve, value),
      (cause) => settle(reject, cause)
    );
  });
}
