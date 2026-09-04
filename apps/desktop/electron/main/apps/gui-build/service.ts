/**
 * [INPUT]: Depends on deterministic component scaffold, the sole immutable source preparer, strict frozen-manifest parsing, independent new-generation gate admission, fail-closed compiler sandbox, fixed transform metadata, and compiled-v3 sealer
 * [OUTPUT]: Provides one scaffold/prepare/compile/seal lifecycle whose cleanup owns every private staging root
 * [POS]: apps/gui-build orchestration facade consumed by AppGenerationBuilder; authoring sync precedes freeze and planning never rereads a live App root
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  AppGuiBuildFinding,
  AppGuiBuildReceipt,
  BaseAppManifest,
} from "../../../../shared/apps-ipc";
import type { Sha256Digest } from "../../../../shared/extensions-ipc";
import type { AppSourcePreparePort, CompilerSandboxPort, SourceFreezeReceipt } from "./contracts";
import { platformCompilerCustodyDigest, TRANSFORM_CONTRACT_DIGEST } from "./metadata";
import { sealCompiledV3Artifact, type CompiledV3DigestSet } from "./pipeline/seal";
import { AppGuiComponentScaffolder } from "./scaffold/component-scaffolder";
import { AppGuiAdmissionPolicy } from "./admission";
import { appManifestSchema } from "../install/manifest-schema";
import { canonicalJson } from "./metadata";

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
      await rm(path, { recursive: true, force: true });
    }
  }

  async prepare(input: Readonly<{
    appId: string;
    sourceRoot: string;
    manifest: BaseAppManifest;
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
        nativePayloads: this.options.nativePayloads,
      });
      const outcome = await this.sandbox.compile({
        snapshotRoot: source.snapshotRoot,
        outputRoot,
        tempRoot,
        sourcePackageDigest: source.sourcePackageDigest,
        transformContractDigest: TRANSFORM_CONTRACT_DIGEST,
        platformCompilerCustodyDigest: custodyDigest,
      }, input.signal ?? new AbortController().signal);
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
        await rm(operationRoot, { recursive: true, force: true });
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
      await rm(operationRoot, { recursive: true, force: true });
      throw cause;
    }
  }
}

export async function requireFrozenBuildManifest(
  snapshotRoot: string,
  admitted: BaseAppManifest
): Promise<BaseAppManifest & Readonly<{
  gui: NonNullable<BaseAppManifest["gui"]> & Readonly<{
    build: NonNullable<NonNullable<BaseAppManifest["gui"]>["build"]>;
  }>;
}>> {
  const frozen = appManifestSchema.parse(
    JSON.parse(await readFile(join(snapshotRoot, "app.json"), "utf8"))
  );
  if (frozen.kind !== "base" || !frozen.gui?.build) {
    throw buildError("GUI_BUILD_MANIFEST_INVALID", "compiled Base manifest is missing gui.build");
  }
  if (canonicalJson(frozen) !== canonicalJson(admitted)) {
    /* 共享的 finding 码集合里没有 MANIFEST_CHANGED；用它等于向 renderer 发一个
       无人认识的字符串。语义由 message 承担，码保持在契约之内。 */
    throw buildError("GUI_BUILD_MANIFEST_INVALID", "frozen app.json differs from the admitted manifest");
  }
  return frozen as BaseAppManifest & Readonly<{
    gui: NonNullable<BaseAppManifest["gui"]> & Readonly<{
      build: NonNullable<NonNullable<BaseAppManifest["gui"]>["build"]>;
    }>;
  }>;
}

function buildError(code: AppGuiBuildFinding["code"], message: string) {
  return Object.assign(new Error(message), { code, findings: [{ code, file: "app.json", message }] });
}
