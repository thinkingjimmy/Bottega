/**
 * [INPUT]: Depends on git, fixed subprocesses, package-contract, Extension installer preflight, app-config-store, strict manifest/base.json schema and userData temporary root
 * [OUTPUT]: Provides RepoProbeService; no-checkout freeze App HEAD/digest and single-use delivery after disclosure of source-related extensionRequirements
 * [POS]: Pre-check the boundaries of the remote supply chain for apps/share; The package contract is strictly limited to kind: base packages, and web warehouses are not subject to regulation
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AppExtensionInstallPreflight,
  AppRepoProbeResult,
} from "../../../../shared/apps-ipc";
import type { AppExtensionRequirementDeclaration } from "../../../../shared/extensions-ipc";
import { GLOBAL_PRODUCT_RESOURCE_SCOPE } from "../../../../shared/product-resource-scope";
import { baseSnapshotFileSchema } from "../../../../shared/base-snapshot";
import { sanitizedProcessEnvironment } from "../../codex-runtime";
import { appManifestSchema } from "../install/manifest-schema";
import { validateConfigRequirements } from "./app-config-store";
import {
  isAllowedPackagePath,
  isSafePackagePath,
  packageDigest,
  PACKAGE_BUDGET,
} from "./package-contract";
import { detectCliRequirements } from "./cli-detectors";
import { digestCanonical } from "../../extensions/registry-store";
import type {
  ExtensionInstallPreflight,
  ExtensionInstaller,
} from "../../extensions/install/installer";

type FrozenProbe = {
  repoUrl: string;
  digest: string;
  commitSha: string;
  packageRoot: string;
  extensionPreflights: AppExtensionInstallPreflight[];
};

type ExtensionProbePort = Pick<
  ExtensionInstaller,
  "preflight" | "discard" | "scopeRevision"
>;

type TreeEntry = {
  mode: string;
  type: string;
  object: string;
  bytes: number;
  path: string;
};

export class RepoProbeService {
  private readonly root: string;
  private readonly probes = new Map<string, FrozenProbe>();
  private extensions: ExtensionProbePort | null = null;

  constructor(userData: string) {
    this.root = join(userData, "app-probes");
  }

  configureExtensions(port: ExtensionProbePort) {
    if (this.extensions) throw new Error("App probe extension preflight 已配置");
    this.extensions = port;
  }

  async probe(
    repoUrl: string,
    expectedCommitSha?: string
  ): Promise<AppRepoProbeResult> {
    const id = randomUUID();
    const staging = join(this.root, id);
    const repository = join(staging, "repo");
    const packageRoot = join(staging, "package");
    await mkdir(repository, { recursive: true, mode: 0o700 });
    const extensionPreflights: AppExtensionInstallPreflight[] = [];
    try {
      let commitSha: string;
      if (expectedCommitSha) {
        if (!/^[0-9a-f]{40}$/.test(expectedCommitSha)) {
          throw new Error("期望 commit SHA 无效");
        }
        await git(["init"], repository);
        await git(["remote", "add", "origin", repoUrl], repository);
        await git(
          ["fetch", "--depth", "1", "origin", expectedCommitSha],
          repository
        );
        commitSha = (await git(["rev-parse", "FETCH_HEAD"], repository)).trim();
      } else {
        await git(
          ["clone", "--no-checkout", "--depth", "1", repoUrl, "."],
          repository
        );
        commitSha = (await git(["rev-parse", "HEAD"], repository)).trim();
      }
      if (expectedCommitSha && commitSha !== expectedCommitSha) {
        throw new Error("远端返回 commit 与期望 pin 不一致");
      }

      /* 判型先行：app.json 缺失/非 JSON/kind≠base 一律走既有 web 安装流程
       * （其自带「将执行第三方代码」的总体风险确认）；包契约的严格面只属于
       * 承诺零执行的 base 包，web 仓库里的 symlink 或撞名 app.json 不在管辖内。 */
      const manifestJson = await readBaseManifestJson(repository, commitSha);
      if (manifestJson === null) {
        await rm(staging, { recursive: true, force: true });
        return { kind: "web", repoUrl };
      }
      const manifest = appManifestSchema.parse(manifestJson);
      if (manifest.kind !== "base") {
        await rm(staging, { recursive: true, force: true });
        return { kind: "web", repoUrl };
      }
      validateConfigRequirements(manifest.requirements?.tools ?? []);

      const entries = parseTree(
        await git(["ls-tree", "-r", "-l", "-z", commitSha], repository)
      );
      const invalidPath = entries.find((entry) => !isSafePackagePath(entry.path));
      if (invalidPath) {
        throw new Error(`App 包路径无效：${JSON.stringify(invalidPath.path)}`);
      }
      const unsafe = entries.find(
        (entry) => entry.mode === "120000" || entry.mode === "160000"
      );
      if (unsafe) {
        throw new Error(`App 包拒绝 symlink/submodule：${unsafe.path}`);
      }

      const ignored: string[] = [];
      const files: Array<{ path: string; bytes: number }> = [];
      const byPath = new Map<string, Buffer>();
      let totalBytes = 0;
      await mkdir(packageRoot, { recursive: true, mode: 0o700 });
      for (const entry of entries) {
        if (!isAllowedPackagePath(entry.path)) {
          ignored.push(entry.path);
          continue;
        }
        if (entry.type !== "blob") throw new Error(`包条目不是 blob：${entry.path}`);
        const depth = entry.path.split("/").length - 1;
        if (depth > PACKAGE_BUDGET.depth) throw new Error("App 包目录深度超过 6");
        const limit =
          entry.path === "data/base.json"
            ? PACKAGE_BUDGET.baseFileBytes
            : PACKAGE_BUDGET.fileBytes;
        if (
          !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 ||
          entry.bytes > limit
        ) {
          throw new Error(`App 包文件超限：${entry.path}`);
        }
        totalBytes += entry.bytes;
        files.push({ path: entry.path, bytes: entry.bytes });
        if (
          files.length > PACKAGE_BUDGET.files ||
          totalBytes > PACKAGE_BUDGET.totalBytes
        ) {
          throw new Error("App 包超过 512 文件或 16 MB 总预算");
        }
        const content = await gitBuffer(
          ["cat-file", "blob", entry.object],
          repository,
          Math.max(entry.bytes + 1024, 1024 * 1024)
        );
        if (content.byteLength !== entry.bytes) {
          throw new Error(`Git blob 长度不符：${entry.path}`);
        }
        const target = join(packageRoot, entry.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, content, { mode: 0o400 });
        await chmod(target, 0o400);
        byPath.set(entry.path, content);
      }

      const snapshot = baseSnapshotFileSchema.parse(
        JSON.parse(requireUtf8(byPath, "data/base.json"))
      );
      const requirements = manifest.requirements?.tools ?? [];
      const cliStatuses = await detectCliRequirements(requirements);
      const digest = await packageDigest(packageRoot, files);
      const disclosures = [...byPath]
        .filter(
          ([path]) =>
            path === "AGENTS.md" ||
            path === "README.md" ||
            path === "README.zh-CN.md" ||
            /^\.agents\/skills\/(?:.+\/)?SKILL\.md$/.test(path)
        )
        .map(([path, content]) => ({ path, content: content.toString("utf8") }));
      for (const declaration of manifest.extensionRequirements ?? []) {
        const frozen = await this.preflightExtension(declaration);
        if (frozen) extensionPreflights.push(frozen);
      }
      this.probes.set(id, {
        repoUrl,
        digest,
        commitSha,
        packageRoot,
        extensionPreflights,
      });
      return {
        kind: "base",
        repoUrl,
        preflightId: id,
        digest,
        commitSha,
        manifest,
        requirements,
        cliStatuses,
        disclosures,
        files,
        ignored,
        rowCount: snapshot.rows.length,
        hasGui: files.some((file) => file.path.startsWith("gui/")),
        extensionPreflights,
      };
    } catch (cause) {
      await Promise.allSettled(
        extensionPreflights.flatMap((item) =>
          item.preflightId && this.extensions
            ? [this.extensions.discard(item.preflightId)]
            : []
        )
      );
      await rm(staging, { recursive: true, force: true });
      throw cause;
    }
  }

  consume(preflightId: string, digest: string, repoUrl: string) {
    const probe = this.probes.get(preflightId);
    if (!probe || probe.digest !== digest || probe.repoUrl !== repoUrl) {
      throw new Error("preflight 已失效或与冻结提交不一致");
    }
    this.probes.delete(preflightId);
    return structuredClone(probe);
  }

  async discard(preflightId: string) {
    const probe = this.probes.get(preflightId);
    this.probes.delete(preflightId);
    if (probe) {
      await Promise.allSettled(
        probe.extensionPreflights.flatMap((item) =>
          item.preflightId && this.extensions
            ? [this.extensions.discard(item.preflightId)]
            : []
        )
      );
      await rm(dirname(probe.packageRoot), { recursive: true, force: true });
    }
  }

  private async preflightExtension(
    declaration: AppExtensionRequirementDeclaration
  ): Promise<AppExtensionInstallPreflight | null> {
    if (!declaration.source) return null;
    if (!this.extensions) {
      throw new Error("带 source 的 extension requirement 缺少 fulfillment owner");
    }
    const preflight = await this.extensions.preflight({
      repoUrl: declaration.source.repoUrl,
      ...(declaration.source.ref ? { requestedRef: declaration.source.ref } : {}),
      scope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
      expectedProjectLifecycleRevision: null,
      expectedScopeRevision: this.extensions.scopeRevision(
        GLOBAL_PRODUCT_RESOURCE_SCOPE
      ),
    });
    assertPreflightComponent(
      preflight,
      declaration.declaredComponentIdentity
    );
    return {
      declaredComponentIdentity: declaration.declaredComponentIdentity,
      scope: preflight.scope,
      projectLifecycleRevision: preflight.projectLifecycleRevision,
      scopeRevision: preflight.scopeRevision,
      repoUrl: preflight.source.normalizedUrl,
      requestedRef: preflight.source.requestedRef,
      resolvedCommit: preflight.source.resolvedCommit,
      contentDigest: preflight.contentDigest,
      capabilityDigest: digestCanonical(preflight.disclosure),
      capabilities: structuredClone(preflight.disclosure),
      preflightId: preflight.preflightId,
      state: "ready",
    };
  }
}

function assertPreflightComponent(
  preflight: ExtensionInstallPreflight,
  declaredComponentIdentity: string
) {
  const identities = preflight.admission.components.map(
    (component) => `${preflight.componentNamespace}/${component.componentId}`
  );
  if (!identities.includes(declaredComponentIdentity)) {
    throw new Error(
      `Extension 来源未提供声明组件：${declaredComponentIdentity}`
    );
  }
}

/** 判型探针：app.json 缺失/非 JSON/kind≠base 都返回 null（走 web 流程），不在此做严格校验。 */
async function readBaseManifestJson(
  repository: string,
  commitSha: string
): Promise<unknown> {
  const raw = await gitBuffer(
    ["cat-file", "blob", `${commitSha}:app.json`],
    repository,
    PACKAGE_BUDGET.fileBytes + 1024
  ).catch(() => null);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return parsed &&
      typeof parsed === "object" &&
      (parsed as { kind?: unknown }).kind === "base"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseTree(value: string): TreeEntry[] {
  return value
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const match =
        /^([0-9]{6}) ([a-z]+) ([0-9a-f]+) +([0-9]+|-)\t(.+)$/.exec(line);
      if (!match || match[5]!.includes("\0")) throw new Error("Git tree 输出无效");
      return {
        mode: match[1]!,
        type: match[2]!,
        object: match[3]!,
        bytes: match[4] === "-" ? Number.NaN : Number(match[4]),
        path: match[5]!,
      };
    });
}

function requireUtf8(content: Map<string, Buffer>, path: string) {
  const value = content.get(path);
  if (!value) throw new Error(`Base App 包缺少 ${path}`);
  return value.toString("utf8");
}

function git(args: string[], cwd: string) {
  return gitBuffer(args, cwd, 32 * 1024 * 1024).then((value) =>
    value.toString("utf8")
  );
}

function gitBuffer(args: string[], cwd: string, maxBuffer: number) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: sanitizedProcessEnvironment(),
        encoding: "buffer",
        maxBuffer,
        timeout: 60_000,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args[0]} 失败：${stderr.toString("utf8").trim()}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
