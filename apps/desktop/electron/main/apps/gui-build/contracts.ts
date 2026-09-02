/**
 * [INPUT]: Depends on shared compiled GUI manifest, receipt, finding, and SHA-256 contracts
 * [OUTPUT]: Provides immutable source, compiler sandbox, generated artifact, and fixed budget ports
 * [POS]: Main apps/gui-build contract leaf; preparation, sandbox, compiler, and generation builder meet here
 */

import type {
  AppGuiBuildFinding,
  AppGuiBuildReceipt,
  BaseGuiBuildManifest,
} from "../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";

export const APP_GUI_BUILD_BUDGET = Object.freeze({
  sourceFiles: 512,
  sourceBytes: 16 * 1024 * 1024,
  sourceDepth: 6,
  wallTimeMs: 15_000,
  rssBytes: 512 * 1024 * 1024,
  cpuTimeMs: 15_000,
  processCount: 4,
  generatedJsBytes: 4 * 1024 * 1024,
  generatedCssBytes: 2 * 1024 * 1024,
  generatedFiles: 256,
  generatedBytes: 32 * 1024 * 1024,
  findings: 100,
  findingMessageBytes: 1_024,
  stdoutBytes: 256 * 1024,
  stderrBytes: 256 * 1024,
} as const);

export type SourceFreezeReceipt = Readonly<{
  snapshotRoot: string;
  sourcePackageDigest: Sha256Digest;
  files: readonly Readonly<{ path: string; bytes: number; sha256: Sha256Digest }>[];
}>;

export type AppSourcePreparePort = Readonly<{
  freeze(input: Readonly<{
    appId: string;
    liveRoot: string;
    stagingParent: string;
    compiled: boolean;
  }>): Promise<SourceFreezeReceipt>;
  discard(receipt: SourceFreezeReceipt): Promise<void>;
}>;

export type SealedCompilerInput = Readonly<{
  operationId: string;
  snapshotRoot: string;
  outputRoot: string;
  tempRoot: string;
  build: BaseGuiBuildManifest;
  sourcePackageDigest: Sha256Digest;
  transformContractDigest: Sha256Digest;
  platformCompilerCustodyDigest: Sha256Digest;
}>;

export type CompilerArtifact = Readonly<{
  runtimeRoot: string;
  receipt: AppGuiBuildReceipt;
  buildReceiptDigest: Sha256Digest;
}>;

export type CompilerOutcome =
  | Readonly<{ status: "compiled"; artifact: CompilerArtifact; findings: readonly AppGuiBuildFinding[] }>
  | Readonly<{ status: "failed"; findings: readonly AppGuiBuildFinding[] }>;

export type CompilerSandboxEvidence = Readonly<{
  supported: true;
  platform: "darwin" | "win32" | "linux";
  evidenceDigest: Sha256Digest;
  probes: readonly Readonly<{ id: string; denied: boolean }>[];
}>;

export type CompilerSandboxPort = Readonly<{
  platform: "darwin" | "win32" | "linux";
  probe(): Promise<CompilerSandboxEvidence>;
  compile(input: SealedCompilerInput, signal: AbortSignal): Promise<CompilerOutcome>;
}>;
