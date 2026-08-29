/**
 * [INPUT]: Depends on immutable Extension inventory records, sealed package bytes, and the canonical digest contract
 * [OUTPUT]: Provides ClaudePluginProjection with verified skills-only artifacts measured on the installer's byte-ordered ruler, root-shared invocation ordering/leases, collision-safe names, receipts, and double-zero GC that also reclaims crashed stage roots
 * [POS]: Process-wide Claude product-plugin trust boundary; replaceable window instances share artifact control truth and never spawn from mutable pointers
 */

import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  opendir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ExtensionInventorySnapshot } from "../../../shared/extensions-ipc";
import { digestCanonical } from "./registry-store";
import { extensionPackageRoot } from "./skill-candidates";

type ProjectionResult = Readonly<{
  artifactDigest: `sha256:${string}` | null;
  paths: readonly string[];
  release(): Promise<void>;
}>;

type Derivation = Readonly<{
  derivationId: string;
  enabledSet: readonly string[];
  generations: readonly string[];
  observedDigests: readonly `sha256:${string}`[];
  translatorVersion: 1;
  artifactDigest: `sha256:${string}`;
}>;

type CurrentProjection = Readonly<{
  derivationId: string;
  artifactDigest: `sha256:${string}`;
}>;

type SelectedPlugin = Readonly<{
  pluginName: string;
  sourceIdentity: string;
  sourceRoot: string;
  generation: string;
  observedDigest: `sha256:${string}`;
  skills: readonly Readonly<{
    identity: string;
    name: string;
    path: string;
  }>[];
}>;

type ProjectionCoordinator = {
  leases: Map<string, number>;
  serial: Promise<void>;
};

/* Windows are replaceable; projection bytes are not. Every instance targeting
   the same root therefore shares one ordering line and one lease ledger. */
const coordinators = new Map<string, ProjectionCoordinator>();

function coordinatorFor(root: string) {
  const existing = coordinators.get(root);
  if (existing) return existing;
  const created = {
    leases: new Map<string, number>(),
    serial: Promise.resolve(),
  };
  coordinators.set(root, created);
  return created;
}

export class ClaudePluginProjection {
  private readonly root: string;
  private readonly coordinator: ProjectionCoordinator;

  constructor(private readonly userData: string) {
    this.root = resolve(userData, "agent-plugin-projections", "claude");
    this.coordinator = coordinatorFor(this.root);
  }

  async build(inventory: ExtensionInventorySnapshot): Promise<ProjectionResult> {
    return this.exclusive(() => this.buildExclusive(inventory));
  }

  private async buildExclusive(
    inventory: ExtensionInventorySnapshot
  ): Promise<ProjectionResult> {
    const selected = await selectedSkills(inventory, this.userData);
    if (!selected.length) {
      await this.clearCurrent();
      await this.collectArtifacts();
      return { artifactDigest: null, paths: [], release: async () => undefined };
    }
    await mkdir(join(this.root, "artifacts"), { recursive: true });
    const stage = join(this.root, `.stage-${randomUUID()}`);
    const sourceStage = join(this.root, `.sources-${randomUUID()}`);
    await mkdir(stage, { recursive: true });
    let artifactDigest: `sha256:${string}` | undefined;
    let leased = false;
    try {
      const frozen = await snapshotSelectedSources(sourceStage, selected);
      const relativePaths = await projectSelected(stage, frozen);
      await rm(sourceStage, { recursive: true, force: true });
      artifactDigest = await digestTree(stage);
      const digest = artifactDigest;
      const artifactRoot = join(this.root, "artifacts", digest.slice(7));
      const derivation = makeDerivation(selected, digest);
      /* The entire build already owns the shared ordering line. Register the
         lease before publication so no later GC can observe a zero-ref gap. */
      this.acquireLease(digest);
      leased = true;
      await this.publishVerified(stage, artifactRoot, digest);
      await this.recordDerivation(derivation);
      await this.switchCurrent({
        derivationId: derivation.derivationId,
        artifactDigest: digest,
      });
      await this.collectArtifacts();
      const concrete = relativePaths.map((path) => join(artifactRoot, path));
      const controlRoot = join(this.root, "current");
      if (concrete.some((path) => path === controlRoot || path.startsWith(`${controlRoot}${sep}`))) {
        throw new Error("Claude plugin spawn path must not use the current control pointer");
      }
      let released = false;
      return {
        artifactDigest: digest,
        paths: concrete,
        release: async () => {
          if (released) return;
          released = true;
          await this.exclusive(async () => {
            this.releaseLease(digest);
            await this.collectArtifacts();
          });
        },
      };
    } catch (cause) {
      await rm(stage, { recursive: true, force: true });
      await rm(sourceStage, { recursive: true, force: true });
      if (leased && artifactDigest) {
        this.releaseLease(artifactDigest);
        await this.collectArtifacts().catch(() => undefined);
      }
      throw cause;
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.coordinator.serial.then(operation, operation);
    this.coordinator.serial = run.then(() => undefined, () => undefined);
    return run;
  }

  private acquireLease(digest: `sha256:${string}`) {
    this.coordinator.leases.set(
      digest,
      (this.coordinator.leases.get(digest) ?? 0) + 1
    );
  }

  private releaseLease(digest: `sha256:${string}`) {
    const remaining = (this.coordinator.leases.get(digest) ?? 0) - 1;
    if (remaining > 0) this.coordinator.leases.set(digest, remaining);
    else this.coordinator.leases.delete(digest);
  }

  private async publishVerified(
    stage: string,
    artifactRoot: string,
    expected: `sha256:${string}`
  ) {
    try {
      await rename(stage, artifactRoot);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw cause;
      /* 同名只说明“声称相同”，不说明字节相同。已存在内容必须重新验真；
         篡改时 fail-closed，绝不原地覆盖仍可能被在途 turn 持有的目录。 */
      const observed = await digestTree(artifactRoot);
      if (observed !== expected) {
        throw new Error("Claude plugin artifact integrity check failed");
      }
      await rm(stage, { recursive: true, force: true });
    }
    const observed = await digestTree(artifactRoot);
    if (observed !== expected) {
      throw new Error("Claude plugin artifact changed during publication");
    }
  }

  private async switchCurrent(current: CurrentProjection) {
    const path = join(this.root, "current");
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(current)}\n`, "utf8");
    await rename(temporary, path);
  }

  private async clearCurrent() {
    await rm(join(this.root, "current"), { force: true });
  }

  private async current(): Promise<CurrentProjection | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.root, "current"), "utf8"));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.derivationId !== "string" ||
        !isDigest(parsed.artifactDigest)
      ) {
        throw new Error("Claude plugin current control record is invalid");
      }
      return parsed as CurrentProjection;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
  }

  private async collectArtifacts() {
    await this.collectStages();
    const active = await this.activeDerivationArtifacts();
    const artifacts = join(this.root, "artifacts");
    let entries;
    try {
      entries = await readdir(artifacts, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/u.test(entry.name)) continue;
      const digest = `sha256:${entry.name}`;
      /* 双归零：active Derivation 与 turn lease 都没有引用时才可回收。 */
      if (
        active.has(digest) ||
        (this.coordinator.leases.get(digest) ?? 0) > 0
      ) continue;
      await rm(join(artifacts, entry.name), { recursive: true, force: true });
    }
  }

  /**
   * 每条进到回收的路径上，本轮 stage 要么已被 rename 成 artifact、要么已被删，
   * 而 build 与 release 共用同一条 serial 线 ⇒ 此刻根上还剩的 `.stage-*` /
   * `.sources-*` 只可能是上一次进程崩溃留下的。`.sources-*` 是每个启用包的
   * 整份副本，不扫它就是按包体积泄漏磁盘——artifact 有双归零看着，这两个
   * 目录此前谁也不看。
   */
  private async collectStages() {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        !(entry.name.startsWith(".stage-") || entry.name.startsWith(".sources-"))
      ) continue;
      await rm(join(this.root, entry.name), { recursive: true, force: true });
    }
  }

  private async activeDerivationArtifacts() {
    const current = await this.current();
    if (!current) return new Set<string>();
    const derivations = await this.readDerivations();
    const active = derivations.find(
      (item) => item.derivationId === current.derivationId
    );
    if (!active || active.artifactDigest !== current.artifactDigest) {
      throw new Error("Claude plugin current projection has no matching derivation");
    }
    return new Set([active.artifactDigest]);
  }

  private async readDerivations(): Promise<Derivation[]> {
    const path = join(this.root, "derivations.json");
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Claude derivation ledger is invalid");
      return parsed as Derivation[];
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  private async recordDerivation(next: Derivation) {
    const path = join(this.root, "derivations.json");
    const current = await this.readDerivations();
    const existing = current.find((item) => item.derivationId === next.derivationId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(next)) {
        throw new Error("Claude derivation identity collision");
      }
      return;
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify([...current, next], null, 2)}\n`, "utf8");
    await rename(temporary, path);
  }
}

async function selectedSkills(
  inventory: ExtensionInventorySnapshot,
  userData: string
): Promise<SelectedPlugin[]> {
  const candidates = [];
  for (const owner of inventory.packages) {
    if (
      owner.administrativeState !== "active" ||
      owner.enabled !== "enabled" ||
      !owner.globalCatalogEnabled ||
      !owner.activeGenerationRef
    ) continue;
    const generation = owner.generations.find(
      (item) => item.packageGenerationId === owner.activeGenerationRef!.packageGenerationId
    );
    if (!generation) continue;
    const packageRoot = extensionPackageRoot(userData, generation.contentDigest);
    const observedDigest = await digestTree(packageRoot);
    if (observedDigest !== generation.contentDigest) {
      throw new Error(`Claude plugin source integrity check failed: ${owner.installIdentity}`);
    }
    const skills = inventory.components.flatMap((component) => {
      if (
        component.kind !== "skill" ||
        component.packageGenerationRef.packageGenerationId !== generation.packageGenerationId ||
        !owner.enabledComponentInstanceIdentities.includes(
          component.componentInstanceIdentity
        )
      ) return [];
      const name = component.componentId.replace(/^skill:/, "");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) return [];
      return [{
        identity: component.componentInstanceIdentity,
        name,
        path: join(packageRoot, "skills", name),
      }];
    });
    if (!skills.length) continue;
    candidates.push({
      pluginBaseName: safePluginName(generation.displayName ?? owner.installIdentity),
      sourceIdentity: owner.installIdentity,
      sourceRoot: packageRoot,
      generation: generation.packageGenerationId,
      observedDigest,
      skills,
    });
  }
  const counts = new Map<string, number>();
  for (const item of candidates) {
    counts.set(item.pluginBaseName, (counts.get(item.pluginBaseName) ?? 0) + 1);
  }
  const identities = new Set<string>();
  for (const item of candidates) {
    if (identities.has(item.sourceIdentity)) {
      throw new Error(`Duplicate Claude plugin source identity: ${item.sourceIdentity}`);
    }
    identities.add(item.sourceIdentity);
  }
  const names = new Map<string, string>();
  const used = new Set<string>();
  for (const item of [...candidates].sort((left, right) =>
    left.sourceIdentity.localeCompare(right.sourceIdentity)
  )) {
    const preferred = counts.get(item.pluginBaseName) === 1
      ? item.pluginBaseName
      : `${item.pluginBaseName.slice(0, 80)}-${shortHash(item.sourceIdentity)}`;
    let pluginName = preferred;
    let salt = 0;
    while (used.has(pluginName)) {
      const suffix = createHash("sha256")
        .update(`${item.sourceIdentity}\0${salt}`)
        .digest("hex");
      pluginName = `${item.pluginBaseName.slice(0, 35)}-${suffix}`;
      salt += 1;
    }
    used.add(pluginName);
    names.set(item.sourceIdentity, pluginName);
  }
  return candidates.map(({ pluginBaseName, ...item }) => ({
    ...item,
    pluginName: names.get(item.sourceIdentity) ?? pluginBaseName,
  }));
}

async function snapshotSelectedSources(
  root: string,
  selected: readonly SelectedPlugin[]
): Promise<SelectedPlugin[]> {
  return Promise.all(selected.map(async (plugin, index) => {
    const snapshotRoot = join(root, String(index));
    /* 产物只从这份已验 digest 的私有快照读取。即使包根在第一次校验后
       被改写，复制所得字节也必须整体重新命中 sealed generation digest。 */
    await copyTree(plugin.sourceRoot, snapshotRoot);
    const observed = await digestTree(snapshotRoot);
    if (observed !== plugin.observedDigest) {
      throw new Error(`Claude plugin source changed during snapshot: ${plugin.sourceIdentity}`);
    }
    return {
      ...plugin,
      sourceRoot: snapshotRoot,
      skills: plugin.skills.map((skill) => ({
        ...skill,
        path: join(snapshotRoot, "skills", skill.name),
      })),
    };
  }));
}

async function projectSelected(stage: string, selected: readonly SelectedPlugin[]) {
  const paths: string[] = [];
  for (const plugin of selected) {
    const pluginRoot = join(stage, "plugins", plugin.pluginName);
    const relativeSkills: string[] = [];
    for (const skill of plugin.skills) {
      const relativeSkill = join("skills", skill.name);
      await copyTree(skill.path, join(pluginRoot, relativeSkill));
      relativeSkills.push(`./${relativeSkill}`);
    }
    await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
    /* v1 只产 name + skills；commands/hooks/agents/MCP/system/session 均未准入。 */
    await writeFile(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      `${JSON.stringify({ name: plugin.pluginName, skills: relativeSkills }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    paths.push(join("plugins", plugin.pluginName));
  }
  return paths;
}

function safePluginName(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 100) || `plugin-${shortHash(value)}`;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function copyTree(source: string, target: string): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error("Claude plugin projection rejects symlinks");
  if (metadata.isFile()) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    return;
  }
  if (!metadata.isDirectory()) throw new Error("Claude plugin projection rejects special files");
  await mkdir(target, { recursive: true });
  const directory = await opendir(source);
  for await (const entry of directory) {
    await copyTree(join(source, entry.name), join(target, entry.name));
  }
}

/**
 * 封包与投影必须用同一把尺，否则同一份字节会算出两个 digest，而这一侧的
 * 不等号会被读成「来源被篡改」——一个良性的目录名就能让 Claude 开不了轮。
 *
 * 落盘那一侧的顺序是 git `ls-tree -r`（`install/source.ts` 的 `materialize`），
 * 而 git 的树序规则（目录按带尾斜杠比较）正是为了让递归列举等于**全路径
 * 字节序**。所以这里也只按全路径字节排序：逐层比较裸目录名会在
 * `skills/` 与 `skills.md` 这类前缀相邻处翻转（`.` < `/`）。
 */
async function digestTree(root: string): Promise<`sha256:${string}`> {
  const files: Array<{ path: string; bytes: number; digest: `sha256:${string}` }> = [];
  async function visit(directory: string, prefix = "") {
    const handle = await opendir(directory);
    for await (const entry of handle) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error("Claude plugin digest rejects symlinks");
      if (metadata.isDirectory()) await visit(path, relative);
      else if (metadata.isFile()) {
        const bytes = await readFile(path);
        files.push({
          path: relative,
          bytes: bytes.byteLength,
          digest: digestCanonical(bytes.toString("base64")),
        });
      } else throw new Error("Claude plugin digest rejects special files");
    }
  }
  await visit(root);
  return digestCanonical(files.sort(byPathBytes));
}

/* 码点序会在星散平面上与字节序分家；digest 输入只认字节。 */
function byPathBytes(
  left: Readonly<{ path: string }>,
  right: Readonly<{ path: string }>
) {
  return Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8")
  );
}

function makeDerivation(
  selected: readonly SelectedPlugin[],
  artifactDigest: `sha256:${string}`
): Derivation {
  const source = selected.map((plugin) => ({
    generation: plugin.generation,
    observedDigest: plugin.observedDigest,
    skills: plugin.skills.map((skill) => skill.identity).sort(),
  }));
  return {
    derivationId: createHash("sha256").update(JSON.stringify(source)).digest("hex"),
    enabledSet: selected.flatMap((plugin) => plugin.skills.map((skill) => skill.identity)),
    generations: selected.map((plugin) => plugin.generation),
    observedDigests: selected.map((plugin) => plugin.observedDigest),
    translatorVersion: 1,
    artifactDigest,
  };
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}
