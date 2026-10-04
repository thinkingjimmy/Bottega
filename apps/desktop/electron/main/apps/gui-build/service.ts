/**
 * [INPUT]: Depends on deterministic scaffolding, immutable source preparation and read-only staging cleanup, manifest admission, actual sandbox component evidence, fixed transform metadata, and compiled-v3 sealing
 * [OUTPUT]: Provides one App/plugin scaffold/prepare/compile/seal lifecycle whose cleanup owns every private staging root, including frozen trees left by interrupted builds
 * [POS]: apps/gui-build orchestration facade consumed by AppGenerationBuilder; authoring sync precedes freeze and planning never rereads a live App root
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  AppGuiBuildFinding,
  AppGuiBuildReceipt,
} from "../../../../shared/ipc/apps/apps-ipc";
import type { Sha256Digest } from "../../../../shared/ipc/settings/extensions-ipc";
import type { AppSourcePreparePort, CompilerSandboxPort, SourceFreezeReceipt } from "./contracts";
import { platformCompilerCustodyDigest, TRANSFORM_CONTRACT_DIGEST } from "./metadata";
import { sealCompiledV3Artifact, type CompiledV3DigestSet } from "./pipeline/seal";
import { removeCompilerStagingTree } from "./pipeline/source-preparer";
import { AppGuiComponentScaffolder } from "./scaffold/component-scaffolder";
import { AppGuiAdmissionPolicy } from "./admission";
import { readGuiBuildManifest, type GuiBuildManifest, type CompiledGuiBuildManifest } from "./source/manifest";
import { canonicalJson } from "../support";

const STAGING_OPERATION =
  /^app-gui-[^/\\]+-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type PreparedCompiledAppGui = Readonly<{
  source: SourceFreezeReceipt;
  compilerRuntimeRoot: string;
  receipt: AppGuiBuildReceipt;
  buildReceiptDigest: Sha256Digest;
  digests: CompiledV3DigestSet;
  seal(finalRoot: string): Promise<void>;
  cleanup(): Promise<void>;
}>;

export class AppGuiBuildService {
  constructor(
    private readonly sourcePreparer: AppSourcePreparePort,
    private readonly sandbox: CompilerSandboxPort,
    private readonly components: AppGuiComponentScaffolder,
    private readonly admission: AppGuiAdmissionPolicy,
    private readonly options: Readonly<{
      stagingRoot: string;
      compilerEntry: string;
      sandboxAdapterEntry: string;
      nativePayloads: readonly Readonly<{ id: string; path: string }>[];
    }>
  ) {}

  probe() { return this.sandbox.probe(); }

  async initialize() {
    const stagingRoot = resolve(this.options.stagingRoot);
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(stagingRoot)) {
      /* appId 的形状是 id 工厂的自由，不是清扫器的前提；只锚定本模块自己写下的
         `app-gui-<appId>-<uuid>` 骨架，再用 lstat + 归属校验守住删除权。 */
      if (!STAGING_OPERATION.test(entry)) continue;
      const path = join(stagingRoot, entry);
      if (!path.startsWith(`${stagingRoot}${sep}`)) continue;
      const identity = await lstat(path);
      if (!identity.isDirectory() || identity.isSymbolicLink()) {
        throw new Error("App GUI compiler staging custody is invalid");
      }
      await removeCompilerStagingTree(path);
    }
  }

  async prepare(input: Readonly<{
    appId: string;
    sourceRoot: string;
    manifest: GuiBuildManifest;
    signal?: AbortSignal;
  }>): Promise<PreparedCompiledAppGui> {
    const operationId = `app-gui-${input.appId}-${randomUUID()}`;
    const operationRoot = join(this.options.stagingRoot, operationId);
    const sourceParent = join(operationRoot, "source");
    const outputRoot = join(operationRoot, "output");
    const tempRoot = join(operationRoot, "temp");
    await mkdir(operationRoot, { recursive: true, mode: 0o700 });
    let source: SourceFreezeReceipt | null = null;
    try {
      /* 探针先于脚手架：编译权威不成立时，一行 App 源码都不该被改写。
         证据在进程内按载荷身份缓存，所以这个顺序只在首次构建付出成本。 */
      const evidence = await this.sandbox.probe().catch((cause) => {
        throw buildError(
          "GUI_COMPILER_SANDBOX_UNAVAILABLE",
          cause instanceof Error ? cause.message : String(cause)
        );
      });
      const scaffold = await this.components.sync(input.sourceRoot);
      if (scaffold.status === "conflict") {
        const findings = scaffold.conflicts.map((conflict) => ({
          code: "GUI_BUILD_COMPONENT_UPDATE_CONFLICT" as const,
          file: `gui/src/components/ui/${conflict.componentId}.tsx`,
          message: `${conflict.reason}: ${conflict.diff}`.slice(0, 1_024),
        }));
        throw Object.assign(new Error(findings[0]?.message ?? "Component update conflict"), {
          code: "GUI_BUILD_COMPONENT_UPDATE_CONFLICT",
          findings,
        });
      }
      source = await this.sourcePreparer.freeze({
        appId: input.appId,
        liveRoot: input.sourceRoot,
        stagingParent: sourceParent,
        compiled: true,
      });
      const frozenManifest = await requireFrozenBuildManifest(
        source.snapshotRoot,
        input.manifest
      );
      await this.admission.assert(source, frozenManifest);
      const custodyDigest = await platformCompilerCustodyDigest({
        compilerEntry: this.options.compilerEntry,
        sandboxAdapterEntry: this.options.sandboxAdapterEntry,
        sandboxEvidenceDigest: evidence.evidenceDigest,
        nativePayloads: [...this.options.nativePayloads, ...(evidence.nativePayloads ?? [])],
      });
      const outcome = await this.sandbox.compile({
        snapshotRoot: source.snapshotRoot,
        outputRoot,
        tempRoot,
        sourcePackageDigest: source.sourcePackageDigest,
        transformContractDigest: TRANSFORM_CONTRACT_DIGEST,
        platformCompilerCustodyDigest: custodyDigest,
      }, input.signal ?? new AbortController().signal, evidence.evidenceDigest);
      if (outcome.status === "failed") throw Object.assign(
        new Error(outcome.findings[0]?.message ?? "App GUI compilation failed"),
        { code: outcome.findings[0]?.code, findings: outcome.findings }
      );
      const artifact = outcome.artifact;
      const digests: CompiledV3DigestSet = {
        manifestDigest: artifact.receipt.manifestDigest,
        sourcePackageDigest: artifact.receipt.sourcePackageDigest,
        contentDigest: artifact.receipt.contentDigest,
        buildReceiptDigest: artifact.buildReceiptDigest,
      };
      let cleaned = false;
      const cleanup = async () => {
        if (cleaned) return;
        cleaned = true;
        if (source) await this.sourcePreparer.discard(source).catch(() => undefined);
        await removeCompilerStagingTree(operationRoot);
      };
      return {
        source,
        compilerRuntimeRoot: artifact.runtimeRoot,
        receipt: artifact.receipt,
        buildReceiptDigest: artifact.buildReceiptDigest,
        digests,
        seal: async (finalRoot) => {
          await sealCompiledV3Artifact({
            source: source!,
            compilerRuntimeRoot: artifact.runtimeRoot,
            finalRoot,
            manifest: frozenManifest,
            receipt: artifact.receipt,
            buildReceiptDigest: artifact.buildReceiptDigest,
          });
        },
        cleanup,
      };
    } catch (cause) {
      if (source) await this.sourcePreparer.discard(source).catch(() => undefined);
      await removeCompilerStagingTree(operationRoot);
      throw cause;
    }
  }
}

export async function requireFrozenBuildManifest(snapshotRoot: string, admitted: GuiBuildManifest) {
  const frozen = await readGuiBuildManifest(snapshotRoot);
  if (!frozen.gui?.build) throw buildError("GUI_BUILD_MANIFEST_INVALID", "compiled manifest is missing gui.build");
  if (canonicalJson(frozen) !== canonicalJson(admitted)) throw buildError("GUI_BUILD_MANIFEST_INVALID", "frozen manifest differs from the admitted manifest");
  return frozen as CompiledGuiBuildManifest;
}

function buildError(code: AppGuiBuildFinding["code"], message: string) {
  return Object.assign(new Error(message), { code, findings: [{ code, file: "app.json", message }] });
}
