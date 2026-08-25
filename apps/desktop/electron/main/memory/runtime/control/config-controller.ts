/**
 * [INPUT]: Depends on the provider Configuration panel/InstallSpec, ManagedRoots manifest/config, plist generators and Coordinator, shutdown/initialization/release narrow ports
 * [OUTPUT]: Provides ManagedRuntimeConfigController: Configuration by type one, white list entry, actual extraction destination, analysis, diagnosis of de-sensitivity, tri-Hashtag, and so on, managed/manual deployment with LaunchAgent
 * [POS]: The owner of the configuration status of memory/runtime/control; Coordinator only runs the lifecycle of the order and no longer holds the details of the implementation of the secrets/configIssue
 */

import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  MemoryConfigIssue,
  MemoryConfigPanel,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
  ResolvedConfigValues,
} from "../../../../../shared/memory-ipc";
import {
  assertModelBaseUrl,
  renderRuntimeArgs,
  resolveConfigValues,
  type InstallSpec,
} from "../../core/provider";
import {
  hashFile,
  hashManagedJson,
  renderPlist,
  writeManagedJson,
  writePlistAtomic,
} from "../managed/install-steps";
import type { ManagedManifest } from "../managed/manifest";
import { ManagedRoots } from "../managed/manifest";
import {
  findManagedConfigIssue,
  decideManagedConfigConvergence,
  readSecretValues,
  sameConfigIssue,
} from "../managed/config-files";

type ConfigControllerDependencies = {
  roots: ManagedRoots;
  descriptor: MemoryProviderDescriptor;
  spec: InstallSpec;
  panel?: MemoryConfigPanel;
  launchAgentPath: string;
  initialize(): Promise<unknown>;
  withOwnedServiceStopped<T>(action: () => Promise<T>, startAfter: boolean): Promise<T>;
  publish(): Promise<MemoryRuntimeSnapshot>;
};

export class ManagedRuntimeConfigController {
  private readonly secretsPath: string;
  private configIssue: MemoryConfigIssue | null = null;

  constructor(private readonly dependencies: ConfigControllerDependencies) {
    this.secretsPath = join(dependencies.roots.root, "secrets.json");
  }

  get issue() {
    return this.configIssue;
  }

  hasIssue(issue: MemoryConfigIssue) {
    return sameConfigIssue(this.configIssue, issue);
  }

  async hasRequiredConfiguration() {
    return (await this.resolvedValues()).missingRequired.length === 0;
  }

  async resolvedValues(submitted?: Record<string, string>) {
    return resolveConfigValues(
      this.dependencies.panel,
      await readSecretValues(this.secretsPath),
      submitted
    );
  }

  /** 运行时异常与服务日志会回到 renderer；所有 secret 字段先按最长值脱敏。 */
  async redactDiagnostic(detail: string) {
    const fields = this.dependencies.panel?.fields ?? [];
    const stored = await readSecretValues(this.secretsPath);
    const secrets = fields
      .filter((field) => field.secret)
      .map((field) => stored[field.key])
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.length - left.length);
    return secrets.reduce(
      (current, secret) => current.replaceAll(secret, "<redacted>"),
      detail
    );
  }

  async extractionDestination() {
    const manifest = await this.dependencies.roots.readManifest();
    const projection = this.dependencies.spec.extractionDestination;
    if (projection && manifest?.files[projection.file]?.mode === "manual") {
      return this.readActualDestination(projection.file);
    }
    return this.destinationFromValues((await this.resolvedValues()).values);
  }

  async previewDestination(submitted: Record<string, string>) {
    const manifest = await this.dependencies.roots.readManifest();
    const projection = this.dependencies.spec.extractionDestination;
    if (projection && manifest?.files[projection.file]?.mode === "manual") {
      return this.readActualDestination(projection.file);
    }
    const destination = this.destinationFromValues(
      (await this.resolvedValues(submitted)).values
    );
    if (!destination) throw new Error("提取服务目的地尚未配置");
    return destination;
  }

  async previewIssueDestination(
    issue: MemoryConfigIssue,
    action: "regenerate" | "adopt-manual"
  ) {
    if (!this.hasIssue(issue)) {
      throw new Error("NO_ACTIVE_CONFIG_ISSUE: 当前没有匹配的配置问题");
    }
    if (action === "adopt-manual") {
      return this.readActualDestination(issue.file);
    }
    return this.previewDestination({});
  }

  async detectIssue(manifest: ManagedManifest | null) {
    this.configIssue = manifest
      ? await findManagedConfigIssue(manifest, this.dependencies.roots.dataRoot)
      : null;
    return this.configIssue;
  }

  async write(submitted: Record<string, string>) {
    const { descriptor, panel, roots, spec } = this.dependencies;
    const fields = panel?.fields ?? [];
    const allowed = new Set(fields.map((field) => field.key));
    const unknown = Object.keys(submitted).filter((key) => !allowed.has(key));
    if (unknown.length) {
      throw new Error(`${descriptor.displayName} 不接受这些配置字段：${unknown.join("、")}`);
    }
    const resolved = await this.resolvedValues(submitted);
    if (resolved.missingRequired.length) {
      throw new Error(`请填写必填配置：${resolved.missingRequired.join("、")}`);
    }
    this.assertValueFormats(resolved.values);
    const manifest = await this.requireManifest();
    await this.assertManagedFilesUnchanged(manifest);
    await this.dependencies.withOwnedServiceStopped(async () => {
      await mkdir(roots.root, { recursive: true, mode: 0o700 });
      await writeFile(this.secretsPath, `${JSON.stringify(resolved.values, null, 2)}\n`, {
        mode: 0o600,
      });
      await chmod(this.secretsPath, 0o600);
      if (spec.initMode === "builder") {
        await this.regenerateManagedConfigs(
          manifest,
          resolved.values,
          resolved.missingRequired
        );
      } else {
        await this.dependencies.initialize();
      }
      await this.installPlist();
    }, true);
  }

  async installPlist() {
    const { launchAgentPath, panel, roots, spec } = this.dependencies;
    const logs = join(roots.root, "logs");
    const envFields = new Set(
      (panel?.fields ?? [])
        .filter((field) => field.transport === "env")
        .map((field) => field.key)
    );
    await mkdir(logs, { recursive: true, mode: 0o700 });
    await writePlistAtomic(
      launchAgentPath,
      renderPlist({
        label: spec.launchLabel,
        programArguments: [
          roots.venvBinary(spec.executable),
          ...renderRuntimeArgs(spec.serveArgs, roots.dataRoot),
        ],
        environment: {
          ...spec.staticEnv,
          ...Object.fromEntries(
            Object.entries((await this.resolvedValues()).values).filter(([key]) =>
              envFields.has(key)
            )
          ),
        },
        workingDirectory: roots.dataRoot,
        logDirectory: logs,
      })
    );
  }

  async resolveIssue(action: "regenerate" | "adopt-manual") {
    const issue = this.configIssue;
    if (!issue) throw new Error("NO_ACTIVE_CONFIG_ISSUE: 当前没有待处理的配置问题");
    const { roots } = this.dependencies;
    const manifest = await this.requireManifest();
    const state = manifest.files[issue.file];
    const actualHash = await hashFile(join(roots.dataRoot, issue.file)).catch(() =>
      "0".repeat(64)
    );
    if (
      manifest.instanceId !== issue.instanceId ||
      state?.mode !== "managed" ||
      state.hash !== issue.expectedHash ||
      actualHash !== issue.actualHash
    ) {
      throw new Error("CONFIG_ISSUE_CHANGED: 配置文件状态已变化，请重新检查");
    }
    if (action === "adopt-manual") {
      await this.readActualDestination(issue.file);
      await roots.writeManifest({
        ...manifest,
        files: { ...manifest.files, [issue.file]: { mode: "manual" } },
      });
      this.configIssue = null;
      return;
    }
    const resolved = await this.resolvedValues();
    if (resolved.missingRequired.length) {
      throw new Error(`请先填写必填配置：${resolved.missingRequired.join("、")}`);
    }
    /* 重生成读的是已落盘值：正常已在 write 时过校验，但 secrets 若被
       篡改也必须在写进配置/plist 之前 fail-closed，不放行陌生 base url。 */
    this.assertValueFormats(resolved.values);
    await this.dependencies.withOwnedServiceStopped(async () => {
      await this.regenerateManagedConfigs(
        manifest,
        resolved.values,
        resolved.missingRequired,
        true
      );
      await this.installPlist();
    }, true);
  }

  /** 字段级语义校验：Base URL 这类「决定密钥发去哪」的值不是自由文本。 */
  private assertValueFormats(values: Record<string, string>) {
    for (const field of this.dependencies.panel?.fields ?? []) {
      const value = values[field.key];
      if (!value) continue;
      if (field.format === "model-base-url") assertModelBaseUrl(value);
    }
  }

  private async requireManifest() {
    const manifest = await this.dependencies.roots.readManifest();
    if (!manifest) throw new Error("未找到托管安装 manifest");
    return manifest;
  }

  private async assertManagedFilesUnchanged(manifest: ManagedManifest) {
    const issue = await this.detectIssue(manifest);
    if (!issue) return;
    this.configIssue = issue;
    await this.dependencies.publish();
    throw new Error(
      `CONFIG_DRIFT: ${issue.file} 已被手工修改，请先选择覆盖重生成或接管为手工配置`
    );
  }

  async convergeManagedConfigs() {
    const manifest = await this.requireManifest();
    const resolved = await this.resolvedValues();
    return this.regenerateManagedConfigs(
      manifest,
      resolved.values,
      resolved.missingRequired
    );
  }

  private async regenerateManagedConfigs(
    manifest: ManagedManifest,
    values: ResolvedConfigValues,
    missingRequired: string[],
    allowDrift = false
  ) {
    const { roots, spec } = this.dependencies;
    if (missingRequired.length) {
      return { state: "missing-required" as const, missing: missingRequired };
    }
    const files = { ...manifest.files };
    for (const [file, builder] of Object.entries(spec.configBuilders ?? {})) {
      if (files[file]?.mode === "manual") continue;
      const path = join(roots.dataRoot, file);
      const value = builder({
        dataRoot: roots.dataRoot,
        installRoot: roots.installRoot,
        values,
      });
      const builderHash = hashManagedJson(value);
      const diskHash = await hashFile(path).catch(() => null);
      const state = files[file];
      const manifestHash = state?.mode === "managed" ? state.hash : null;
      const decision = decideManagedConfigConvergence({
        diskHash,
        manifestHash,
        builderHash,
      });
      if (decision === "drift" && !allowDrift) {
        throw new Error(`CONFIG_DRIFT: ${file} 同时偏离 manifest 与受管模板`);
      }
      if (decision !== "adopt-builder-hash") {
        await writeManagedJson(path, value);
      }
      files[file] = { mode: "managed", hash: builderHash };
    }
    await roots.writeManifest({ ...manifest, files });
    this.configIssue = null;
    return { state: "converged" as const };
  }

  private destinationFromValues(values: ResolvedConfigValues) {
    const baseUrl = Object.entries(values).find(([key]) =>
      key.endsWith("BASE_URL")
    )?.[1];
    const model = Object.entries(values).find(([key]) =>
      key.endsWith("MODEL")
    )?.[1];
    if (!baseUrl || !model) return null;
    assertModelBaseUrl(baseUrl);
    return { hostname: new URL(baseUrl).hostname, model };
  }

  private async readActualDestination(file: string) {
    const projection = this.dependencies.spec.extractionDestination;
    if (!projection || projection.file !== file) {
      throw new Error("该配置文件没有可靠的实际目的地解析契约，拒绝手工接管");
    }
    const path = join(this.dependencies.roots.dataRoot, file);
    if ((await stat(path)).size > 1024 * 1024) {
      throw new Error("手工配置过大，拒绝解析目的地");
    }
    let root: unknown;
    try {
      root = JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new Error("手工配置不是可解析的 JSON，拒绝接管");
    }
    const baseUrl = readStringPath(root, projection.baseUrlPath);
    const model = readStringPath(root, projection.modelPath);
    if (!baseUrl || !model || model.length > 512) {
      throw new Error("手工配置缺少有效的 extraction hostname/model，拒绝接管");
    }
    assertModelBaseUrl(baseUrl);
    return { hostname: new URL(baseUrl).hostname, model };
  }
}

function readStringPath(root: unknown, path: ReadonlyArray<string>) {
  let current = root;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}
