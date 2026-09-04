/**
 * [INPUT]: Depends on shared compiled GUI manifest, receipt, finding, and SHA-256 contracts
 * [OUTPUT]: Provides immutable source, compiler sandbox, generated artifact, and fixed budget ports
 * [POS]: Main apps/gui-build contract leaf; preparation, sandbox, compiler, and generation builder meet here
 */

import type {
  AppGuiBuildFinding,
  AppGuiBuildReceipt,
} from "../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";

/* 单文件上限不在这里：真正生效的是 share/package-contract.ts 的
   PACKAGE_BUDGET.fileBytes = 512 KiB，由 inspectPackage 在 AppSourcePreparer.freeze
   里先行判死。这里的 sourceFiles/sourceBytes 只管总量。 */
export const APP_GUI_BUILD_BUDGET = Object.freeze({
  sourceFiles: 512,
  sourceBytes: 16 * 1024 * 1024,
  sourceDepth: 6,
  wallTimeMs: 15_000,
  /* 实测（Apple Silicon，2026-09-03，生产编译子进程）：一个 Starter 构建的进程树
     RSS 求和峰值 ≈ 540 MiB，单进程峰值 ≈ 320 MiB。求和会把共享页重复计数，所以
     supervisor 记的是单进程最大值，预算按它留一倍余量。这个数必须随构建侧基线
     收据重新推导，不能凭手感调。 */
  rssBytes: 768 * 1024 * 1024,
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
  snapshotRoot: string;
  outputRoot: string;
  tempRoot: string;
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
