/**
 * [INPUT]: Depends on ComponentDeliveryPlan, original capability snapshot, authoritative inventory, content addresses, packaging root, Agent Plugins re-admission, agent-input, read only snapshots and controlled executable PATH
 * [OUTPUT]: Provides materialize Component Deliveries: precise review deliveryReference, materialization per-turn skill and sealed-generation MCP resolved config digest with absolute executable/cwd, running env, failed to report
 * [POS]: The only materialization between plan/capability and backend instant delivery; Re-check the packet bytes/citations/digest, but not re-license, nor self-construct reference counts
 */

import { constants } from "node:fs";
import { access, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  ComponentDeliveryPlan,
  ExtensionCapabilitySnapshot,
  ExtensionInventorySnapshot,
  FrozenExtensionDeliveryEligibilityReason,
} from "../../../../shared/extensions-ipc";
import { stageDirectorySnapshot } from "../../agent-input";
import { parseSkillFrontmatter, readStableSkill } from "../../skills-catalog";
import { errorMessage } from "../../errors";
import { digestCanonical } from "../registry-store";
import { extensionPackageRoot } from "../skill-candidates";
import { admitExtensionPackage, type AdmittedMcpServer } from "../manifest-adapter";

export type MaterializedExtensionSkill = Readonly<{
  deliveryInstanceId: string;
  componentInstanceIdentity: string;
  name: string;
  /** 本轮私有只读副本；后端永远看不到包根原路径 */
  path: string;
}>;

export type DeliveryMaterializationFailure = Readonly<{
  deliveryInstanceId: string;
  reason: FrozenExtensionDeliveryEligibilityReason;
}>;

export type MaterializedExtensionMcpServer = Readonly<{
  deliveryInstanceId: string;
  componentInstanceIdentity: string;
  componentId: string;
  serverId: string;
  packageGenerationRef: ComponentDeliveryPlan["deliveries"][number]["packageGenerationRef"];
  declaredConfigDigest: `sha256:${string}`;
  resolvedConfigDigest: `sha256:${string}`;
  config:
    | Readonly<{
        transport: "stdio";
        command: string;
        args: readonly string[];
        env: Readonly<Record<string, string>>;
        cwd?: string;
        pluginRoot: string;
        pluginData: string;
      }>
    | Readonly<{
        transport: "streamable-http" | "sse";
        url: string;
        headers: Readonly<Record<string, string>>;
      }>;
}>;

export type ComponentDeliveryMaterialization = Readonly<{
  skills: readonly MaterializedExtensionSkill[];
  mcpServers: readonly MaterializedExtensionMcpServer[];
  failures: readonly DeliveryMaterializationFailure[];
}>;

/**
 * 逐条物化，不做整体事务：一条 skill 落不下来只淘汰它自己，required/optional
 * 的收敛交回 planner。整体回滚会把「一个 optional 包坏了」升级成「本轮全灭」，
 * 那是把不相干的失败连坐。
 */
export async function materializeComponentDeliveries(input: {
  root: string;
  userData: string;
  inventory: ExtensionInventorySnapshot;
  capability: ExtensionCapabilitySnapshot;
  plan: ComponentDeliveryPlan;
  executableSearchPath?: readonly string[];
}): Promise<ComponentDeliveryMaterialization> {
  const skills: MaterializedExtensionSkill[] = [];
  const mcpServers: MaterializedExtensionMcpServer[] = [];
  const failures: DeliveryMaterializationFailure[] = [];
  if (!input.plan.deliveries.length) return { skills, mcpServers, failures };
  await mkdir(input.root, { recursive: true, mode: 0o700 });
  for (const delivery of input.plan.deliveries) {
    try {
      const component = findComponent(input.inventory, delivery);
      assertDeliveryReference(input, delivery);
      if (component.kind === "skill") {
        if (
          delivery.deliveryRef.strength !== "per-turn-enforced" ||
          delivery.deliveryRef.deliveryChannel !== "manual-snapshot"
        ) {
          throw new Error("skill delivery channel 未实现");
        }
        skills.push(await materializeSkill(input, delivery));
      } else {
        if (delivery.deliveryRef.strength !== "server-inclusion-only") {
          throw new Error("MCP delivery strength 不是 server-inclusion-only");
        }
        mcpServers.push(await materializeMcp(input, delivery));
      }
    } catch (cause) {
      failures.push(
        failure(delivery.deliveryInstanceId, "snapshot-materialization-failed", {
          componentInstanceIdentity: delivery.componentInstanceIdentity,
          detail: errorMessage(cause),
        })
      );
    }
  }
  return { skills, mcpServers, failures };
}

function assertDeliveryReference(
  input: {
    inventory: ExtensionInventorySnapshot;
    capability: ExtensionCapabilitySnapshot;
    plan: ComponentDeliveryPlan;
  },
  delivery: ComponentDeliveryPlan["deliveries"][number]
) {
  if (
    input.plan.visibleInventoryVersion !== input.inventory.visibleInventoryVersion ||
    input.plan.capabilitySnapshotDigest !== input.capability.snapshotDigest ||
    input.capability.visibleInventoryVersion !== input.inventory.visibleInventoryVersion
  ) {
    throw new Error("delivery plan/capability/inventory 快照不一致");
  }
  const capability = input.capability.entries.find((entry) =>
    entry.componentInstanceIdentity === delivery.componentInstanceIdentity &&
    entry.packageGenerationRef.packageGenerationId ===
      delivery.packageGenerationRef.packageGenerationId &&
    entry.packageGenerationRef.recordDigest === delivery.packageGenerationRef.recordDigest
  );
  if (
    !capability?.eligible ||
    !capability.deliveryReference ||
    digestCanonical(capability.deliveryReference) !== digestCanonical(delivery.deliveryRef)
  ) {
    throw new Error("deliveryReference 不是 capability snapshot 的精确 entry");
  }
}

function findComponent(
  inventory: ExtensionInventorySnapshot,
  delivery: ComponentDeliveryPlan["deliveries"][number]
) {
  const component = inventory.components.find(
    (item) => item.componentInstanceIdentity === delivery.componentInstanceIdentity &&
      item.packageGenerationRef.packageGenerationId ===
        delivery.packageGenerationRef.packageGenerationId &&
      item.packageGenerationRef.recordDigest ===
        delivery.packageGenerationRef.recordDigest
  );
  if (!component) throw new Error("计划引用的 component 已不在 inventory 中");
  return component;
}

async function materializeSkill(
  input: {
    root: string;
    userData: string;
    inventory: ExtensionInventorySnapshot;
  },
  delivery: ComponentDeliveryPlan["deliveries"][number]
): Promise<MaterializedExtensionSkill> {
  const component = findComponent(input.inventory, delivery);
  if (component.kind !== "skill") {
    throw new Error("计划引用的 skill component 已不在 inventory 中");
  }
  const generation = input.inventory.packages
    .flatMap((owner) => owner.generations)
    .find(
      (item) =>
        item.packageGenerationId ===
          delivery.packageGenerationRef.packageGenerationId &&
        item.recordDigest === delivery.packageGenerationRef.recordDigest
    );
  if (!generation) throw new Error("计划引用的 package generation 已不可寻址");

  /* `componentId` 形如 `skill:<name>`，目录即 `<包根>/skills/<name>`；与
     skill-candidates 同一条推导，包根仍由 contentDigest 得出而非另存路径。 */
  const directory = component.componentId.replace(/^skill:/, "");
  if (!directory || directory.includes("/") || directory.includes("..")) {
    throw new Error(`component id 不是合法的 skill 目录名：${component.componentId}`);
  }
  /* 包根先 canonical 一次——userData 自身可能坐在符号链接上（macOS 的
     /var→/private/var 就是），而下面两道校验都要求路径等于它的 realpath。
     根内部的符号链接仍然由快照逐项拒绝，这里不放宽任何一条。 */
  const source = join(
    await realpath(extensionPackageRoot(input.userData, generation.contentDigest)),
    "skills",
    directory
  );
  /* 与 $ 面板同一条口径：先按 catalog 的稳定读拿到可信字节，再整目录快照，
     最后逐字节复核副本。两次读之间被换掉的包，在这一步现形。 */
  const trusted = await readStableSkill(join(source, "SKILL.md"));
  const destination = join(input.root, delivery.deliveryInstanceId);
  await stageDirectorySnapshot(source, destination);
  const path = join(destination, "SKILL.md");
  if (!(await readFile(path)).equals(trusted)) {
    throw new Error("Skill 在目录快照期间发生变化");
  }
  return {
    deliveryInstanceId: delivery.deliveryInstanceId,
    componentInstanceIdentity: delivery.componentInstanceIdentity,
    name: parseSkillFrontmatter(trusted.toString("utf8"), directory).name,
    path,
  };
}

async function materializeMcp(
  input: {
    userData: string;
    inventory: ExtensionInventorySnapshot;
    executableSearchPath?: readonly string[];
  },
  delivery: ComponentDeliveryPlan["deliveries"][number]
): Promise<MaterializedExtensionMcpServer> {
  const component = findComponent(input.inventory, delivery);
  if (component.kind !== "mcp-server" || !component.serverId) {
    throw new Error("计划引用的 MCP component 无 server identity");
  }
  const generation = input.inventory.packages
    .flatMap((owner) => owner.generations)
    .find((item) =>
      item.packageGenerationId === delivery.packageGenerationRef.packageGenerationId &&
      item.recordDigest === delivery.packageGenerationRef.recordDigest
    );
  if (!generation) throw new Error("计划引用的 MCP generation 已不可寻址");
  const pluginRoot = await realpath(extensionPackageRoot(input.userData, generation.contentDigest));
  const before = await readFile(join(pluginRoot, "mcp.json"));
  const admission = await admitExtensionPackage(pluginRoot);
  const after = await readFile(join(pluginRoot, "mcp.json"));
  if (!before.equals(after)) throw new Error("mcp.json 在 re-admission 期间发生变化");
  const admitted = admission.components.find(
    (item): item is AdmittedMcpServer =>
      item.kind === "mcp-server" && item.serverId === component.serverId
  );
  if (!admission.valid || !admitted) throw new Error("sealed MCP 无法稳定 re-admit");
  if (
    digestCanonical(admitted) !== component.declarationDigest ||
    digestCanonical(admitted.config) !== component.declaredConfigDigest ||
    digestCanonical(admitted.config) !== delivery.resolvedConfigDigest
  ) {
    throw new Error("MCP declaration/resolved config digest 不一致");
  }
  const identity = {
    deliveryInstanceId: delivery.deliveryInstanceId,
    componentInstanceIdentity: delivery.componentInstanceIdentity,
    componentId: component.componentId,
    serverId: component.serverId,
    packageGenerationRef: structuredClone(delivery.packageGenerationRef),
    declaredConfigDigest: component.declaredConfigDigest,
  };
  if (admitted.config.type !== "stdio") {
    const url = new URL(admitted.config.url);
    if (url.search || Object.keys(admitted.config.headers).length) {
      throw new Error("authenticated/query remote MCP 仍为 unsupported");
    }
    const config = {
      transport: admitted.config.type,
      url: admitted.config.url,
      headers: structuredClone(admitted.config.headers),
    } as const;
    return { ...identity, resolvedConfigDigest: digestCanonical(config), config };
  }
  if (generation.dataBinding.kind !== "stdio") {
    throw new Error("stdio MCP generation 缺 PLUGIN_DATA binding");
  }
  const pluginData = await realpath(join(
    input.userData,
    "agent-extensions",
    "data",
    generation.installIdentity,
    "epochs",
    generation.dataBinding.pluginDataEpochId
  ));
  const command = await freezeExecutable(
    pluginRoot,
    admitted.config.command,
    input.executableSearchPath ?? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
  );
  const expand = (value: string) => value.replace(
    /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g,
    (_match, name: "PLUGIN_ROOT" | "PLUGIN_DATA") =>
      name === "PLUGIN_ROOT" ? pluginRoot : pluginData
  );
  const cwd = admitted.config.cwd
    ? await freezeCwd(pluginRoot, pluginData, admitted.config.cwd, expand)
    : undefined;
  const config = {
    transport: "stdio" as const,
    command,
    args: admitted.config.args.map(expand),
    env: {
      ...Object.fromEntries(
        Object.entries(admitted.config.env).map(([name, value]) => [name, expand(value)])
      ),
      PLUGIN_ROOT: pluginRoot,
      PLUGIN_DATA: pluginData,
    },
    ...(cwd ? { cwd } : {}),
    pluginRoot,
    pluginData,
  };
  return {
    ...identity,
    resolvedConfigDigest: digestCanonical(config),
    config,
  };
}

async function freezeCwd(
  pluginRoot: string,
  pluginData: string,
  declared: string,
  expand: (value: string) => string
) {
  const root = declared.startsWith("${PLUGIN_DATA}") ? pluginData : pluginRoot;
  const candidate = declared.startsWith("./")
    ? resolve(pluginRoot, declared)
    : expand(declared);
  const canonical = await realpath(candidate);
  const escaped = relative(root, canonical);
  if (escaped.startsWith("..") || isAbsolute(escaped)) {
    throw new Error("MCP cwd 通过符号链接逃逸声明根");
  }
  return canonical;
}

async function freezeExecutable(
  pluginRoot: string,
  command: string,
  searchPath: readonly string[]
) {
  const candidates = command.startsWith("./")
    ? [join(pluginRoot, command)]
    : searchPath.map((root) => join(root, command));
  for (const candidate of candidates) {
    try {
      const canonical = await realpath(candidate);
      if (command.startsWith("./")) {
        const escaped = relative(pluginRoot, canonical);
        if (escaped.startsWith("..") || isAbsolute(escaped)) {
          throw new Error("package-relative MCP executable 逃逸 PLUGIN_ROOT");
        }
      }
      await access(canonical, constants.X_OK);
      return canonical;
    } catch (cause) {
      if (command.startsWith("./")) throw cause;
    }
  }
  throw new Error(`受控 PATH 找不到 executable：${command}`);
}

function failure(
  deliveryInstanceId: string,
  code: FrozenExtensionDeliveryEligibilityReason["code"],
  parameters: Record<string, string>
): DeliveryMaterializationFailure {
  return {
    deliveryInstanceId,
    reason: {
      taxonomyVersion: 1,
      code,
      parameters,
      evidenceDigest: digestCanonical({ code, parameters }),
    },
  };
}
