/**
 * [INPUT]: Depends on frozen Git trees, bounded compatibility declarations, the main host version, package projection and existing manifest checks and shared delivery Extension preflight authority.
 * [OUTPUT]: Provides source-bound Base/Web probes, typed compatibility rejection, unavailable-commit classification and single-use Base preflight custody.
 * [POS]: Remote package admission: the stable host gate precedes manifest classification for every declared or first-party App.
 */

import { preflightAppExtension } from "../../install/delivery/preflight";
import { FIRST_PARTY_PRESETS } from "../../../presets/preset-catalog";
import { APP_COMPATIBILITY_BYTE_LIMIT, APP_COMPATIBILITY_FILE, type AppCandidateIdentity } from "../../../../../shared/app-host/contract";
import { AppCompatibilityError, checkCompatibilityBytes, firstPartySource, runningBottegaVersion, type CompatibilityReceipt } from "../../compatibility/read";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { classifyGitFailure, probeFailure } from "./probe-failure";
import { createHash, randomUUID } from "node:crypto";
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
} from "../../../../../shared/ipc/apps/apps-ipc";
import type { AppExtensionRequirementDeclaration } from "../../../../../shared/ipc/settings/extensions-ipc";
import { baseSnapshotFileSchema } from "../../../../../shared/bases/model/base-snapshot";
import { sanitizedProcessEnvironment } from "../../../backends/runtime/runtime-probe";
import { appManifestSchema } from "../../install/manifest-schema";
import { validateConfigRequirements } from "../app-config-store";
import {
  isAllowedPackagePath,
  isSafePackagePath,
  packageDigest,
  PACKAGE_BUDGET,
} from "./package-contract";
import { detectCliRequirements } from "../cli-detectors";
import type {
  ExtensionInstaller,
} from "../../../extensions/install/installer";

type FrozenProbe = {
  repoUrl: string;
  digest: string;
  commitSha: string;
  packageRoot: string;
  extensionPreflights: AppExtensionInstallPreflight[];
  compatibility: CompatibilityReceipt;
  candidate: AppCandidateIdentity;
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

export class AppCandidateUnavailableError extends Error {}

export class RepoProbeService {
  private readonly root: string;
  private readonly probes = new Map<string, FrozenProbe>();
  private extensions: ExtensionProbePort | null = null;

  constructor(userData: string, private readonly hostVersion = runningBottegaVersion) {
    this.root = join(userData, "app-probes");
  }

  configureExtensions(port: ExtensionProbePort) {
    if (this.extensions) throw new Error("App probe extension preflight is already configured");
    this.extensions = port;
  }

  async probe(
    repoUrl: string,
    expectedCommitSha?: string,
    presetId?: string
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
          throw probeFailure("APP_REF_UNAVAILABLE", `expected commit SHA is malformed: ${expectedCommitSha}`);
        }
        await git(["init"], repository);
        await git(["remote", "add", "origin", repoUrl], repository);
        await git(
          ["fetch", "--depth", "1", "origin", expectedCommitSha],
          repository
        ).catch((cause: Error & { code?: string }) => {
          if (cause.code === "APP_REF_UNAVAILABLE") {
            throw new AppCandidateUnavailableError("The frozen App commit is no longer available");
          }
          throw cause;
        });
        commitSha = (await git(["rev-parse", "FETCH_HEAD"], repository)).trim();
      } else {
        await git(
          ["clone", "--no-checkout", "--depth", "1", repoUrl, "."],
          repository
        );
        commitSha = (await git(["rev-parse", "HEAD"], repository)).trim();
      }
      if (expectedCommitSha && commitSha !== expectedCommitSha) {
        throw probeFailure("APP_REF_UNAVAILABLE", `the remote returned ${commitSha}, not the pinned ${expectedCommitSha}`);
      }

      const entries = parseTree(await git(["ls-tree", "-r", "-l", "-z", commitSha], repository));
      const preset = FIRST_PARTY_PRESETS.find((entry) => entry.id === presetId) ?? firstPartySource(repoUrl);
      const candidate: AppCandidateIdentity = {
        appName: preset?.sourceDirectory.replace("Bottega-app-", "") ?? repoUrl.split("/").at(-1)?.replace(/\.git$/, "") ?? "App",
        repoUrl: preset?.canonicalRepoUrl ?? repoUrl,
        presetId: presetId ?? preset?.id,
        commitSha,
        contentDigest: `sha256:${createHash("sha256").update(JSON.stringify(entries)).digest("hex")}`,
      };
      const compatEntry = entries.find((entry) => entry.path === APP_COMPATIBILITY_FILE);
      if (compatEntry && (compatEntry.type !== "blob" || !["100644", "100755"].includes(compatEntry.mode) || compatEntry.bytes > APP_COMPATIBILITY_BYTE_LIMIT)) {
        throw new AppCompatibilityError({ code: "APP_COMPATIBILITY_INVALID", candidate, currentVersion: this.hostVersion(), minBottegaVersion: null, declarationDigest: null });
      }
      const compatBytes = compatEntry
        ? await gitBuffer(["cat-file", "blob", compatEntry.object], repository, APP_COMPATIBILITY_BYTE_LIMIT + 1)
        : undefined;
      const compatibility = checkCompatibilityBytes(compatBytes, candidate, this.hostVersion());

      /* 判型先行：app.json 缺失/非 JSON/kind≠base 一律走既有 web 安装流程
       * （其自带「将执行第三方代码」的总体风险确认）；包契约的严格面只属于
       * 承诺零执行的 base 包，web 仓库里的 symlink 或撞名 app.json 不在管辖内。 */
      const manifestJson = await readBaseManifestJson(repository, commitSha);
      if (manifestJson === null) {
        await rm(staging, { recursive: true, force: true });
        return { kind: "web", repoUrl, commitSha, declarationDigest: compatibility.declarationDigest };
      }
      const parsed = appManifestSchema.safeParse(manifestJson);
      if (!parsed.success) throw probeFailure("APP_PACKAGE_INVALID", `app.json is not a valid manifest: ${parsed.error.message}`);
      const manifest = parsed.data;
      if (manifest.kind !== "base") {
        await rm(staging, { recursive: true, force: true });
        return { kind: "web", repoUrl, commitSha, declarationDigest: compatibility.declarationDigest };
      }
      validateConfigRequirements(manifest.requirements?.tools ?? []);

      const invalidPath = entries.find((entry) => !isSafePackagePath(entry.path));
      if (invalidPath) {
        throw probeFailure("APP_PACKAGE_INVALID", `invalid package path ${JSON.stringify(invalidPath.path)}`);
      }
      const unsafe = entries.find(
        (entry) => entry.mode === "120000" || entry.mode === "160000"
      );
      if (unsafe) {
        throw probeFailure("APP_PACKAGE_INVALID", `symlink or submodule refused: ${unsafe.path}`);
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
        if (entry.type !== "blob") throw probeFailure("APP_PACKAGE_INVALID", `package entry is not a blob: ${entry.path}`);
        const depth = entry.path.split("/").length - 1;
        if (depth > PACKAGE_BUDGET.depth) throw probeFailure("APP_PACKAGE_INVALID", "package directory depth exceeds 6");
        const limit =
          entry.path === "data/base.json"
            ? PACKAGE_BUDGET.baseFileBytes
            : PACKAGE_BUDGET.fileBytes;
        if (
          !Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 ||
          entry.bytes > limit
        ) {
          throw probeFailure("APP_PACKAGE_INVALID", `package file over its budget: ${entry.path}`);
        }
        totalBytes += entry.bytes;
        files.push({ path: entry.path, bytes: entry.bytes });
        if (
          files.length > PACKAGE_BUDGET.files ||
          totalBytes > PACKAGE_BUDGET.totalBytes
        ) {
          throw probeFailure("APP_PACKAGE_INVALID", "package exceeds 512 files or 16 MB in total");
        }
        const content = await gitBuffer(
          ["cat-file", "blob", entry.object],
          repository,
          Math.max(entry.bytes + 1024, 1024 * 1024)
        );
        if (content.byteLength !== entry.bytes) {
          throw probeFailure("APP_PACKAGE_INVALID", `git blob length differs from the tree: ${entry.path}`);
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
        compatibility,
        candidate,
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
      if (cause instanceof AppCompatibilityError) return { kind: "compatibility-blocked", compatibility: cause.compatibility };
      throw cause;
    }
  }

  consume(preflightId: string, digest: string, repoUrl: string) {
    const probe = this.probes.get(preflightId);
    if (!probe || probe.digest !== digest || probe.repoUrl !== repoUrl) {
      throw probeFailure("APP_PROBE_INTERRUPTED", "the preflight expired or no longer matches its frozen commit");
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

  private preflightExtension(declaration: AppExtensionRequirementDeclaration) {
    return preflightAppExtension(declaration, this.extensions);
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
      if (!match || match[5]!.includes("\0")) throw probeFailure("APP_REPOSITORY_PROBE_FAILED", "git ls-tree output did not parse");
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
  if (!value) throw probeFailure("APP_PACKAGE_INVALID", `Base App package lacks ${path}`);
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
          const text = stderr.toString("utf8").trim();
          const facts = error as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null };
          reject(probeFailure(
            classifyGitFailure({ stderr: text, cwdExists: existsSync(cwd), killed: Boolean(facts.killed), signal: facts.signal ?? null, code: facts.code }),
            `git ${args[0]}: ${text || facts.message}`
          ));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
