/**
 * [INPUT]: Depends on shared builtin-tool access/backend allowlists, ProviderId, Agent TurnOrigin, frozen Skills capability facts and live Artifact admission
 * [OUTPUT]: Provides builtinToolAccess, turnKindForOrigin, BuiltinIssuanceInput, issueBuiltinMcpWhenAllowed, projectBuiltinTools, admittedAmbientTools.
 * [POS]: Authorization composition with live plugin admission; backend exclusions, missing origins, and missing Skills capability fail closed before a lease exists
 */

import type { ProviderId } from "@bottega/contracts/model/provider";
import {
  allowedToolsFor,
  toolSpec,
  pluginToolsAvailable,
  type PluginToolName,
  type BuiltinTurnKind,
} from "../../../shared/plugin-tools";
import type { TurnOrigin } from "../agent/bridge/bridge-types";
import { artifactEnabled } from "../artifacts/admission/state";

/* 本轮到底能不能写，只由这一个函数回答。App instructions 与 tool lease 各自
   再推一次，就会出现「工具是只读、文案却说可写」这种自相矛盾的授权叙述。 */
export function builtinToolAccess(input: {
  builtinTools: "none" | "read" | "mutate";
  planMode: boolean;
}) {
  if (input.builtinTools === "none") return "none" as const;
  return input.planMode || input.builtinTools === "read"
    ? ("read" as const)
    : ("mutate" as const);
}

/**
 * origin 的每个分支各自成桶；缺 origin 按 relay 收窄。
 */
export function turnKindForOrigin(
  origin: TurnOrigin | undefined
): BuiltinTurnKind {
  if (origin?.kind === "manual") return "manual";
  return "relay";
}

export type BuiltinIssuanceInput = {
  builtinTools: "none" | "read" | "mutate";
  backend: ProviderId;
  planMode: boolean;
  origin: TurnOrigin | undefined;
  /** 本轮 resolveContext 时冻结的用户偏好；只过滤 ambient 工具。 */
  disabledTools?: readonly string[];
  selectedPlugins?: readonly string[];
  selectedTools?: readonly string[];
  /** Proven capable Skills custody exists for this exact turn. */
  useSkill?: boolean;
  /** 只属于当前 managed-worktree Chat 的精确 main-owned commit authority。 */
  managedWorktreeCommit?: boolean;
};

export function issueBuiltinMcpWhenAllowed<T>(
  input: BuiltinIssuanceInput,
  issue: (allowedTools: PluginToolName[]) => T
) {
  const allowedTools = projectBuiltinTools(input);
  if (allowedTools.length === 0) return undefined;
  return issue(allowedTools);
}

/** runtime CAS 后冻结的最终工具集合；lease 与产品上下文只读这一份结果。 */
export function projectBuiltinTools(
  input: BuiltinIssuanceInput
): PluginToolName[] {
  const access = builtinToolAccess(input);
  if (access === "none") return [];
  const exact = [
    ...(input.useSkill ? (["use_skill"] as PluginToolName[]) : []),
    ...(input.managedWorktreeCommit && access === "mutate" && !input.planMode
      ? (["commit_managed_worktree"] as PluginToolName[])
      : []),
  ];
  return [...admittedTools(input), ...exact].filter((name) => {
    const declaration = toolSpec(name);
    if (!declaration || !pluginToolsAvailable(declaration.pluginId)) return false;
    const allowlist = declaration.backendAllowlist;
    return !allowlist || allowlist.some(id => id === input.backend);
  });
}

/** App instructions 与 lease 共同消费的 ambient 真相；精确签发工具不在其中。 */
export function admittedAmbientTools(
  input: BuiltinIssuanceInput
): PluginToolName[] {
  const access = builtinToolAccess(input);
  const turnKind = turnKindForOrigin(input.origin);
  if (access === "none") return [];
  const disabled = new Set(input.disabledTools ?? []);
  return allowedToolsFor(access, turnKind, input.planMode).filter((name) => {
    const spec = toolSpec(name);
    if (!spec || !pluginToolsAvailable(spec.pluginId)) return false;
    if (disabled.has(name) || disabled.has(spec.identity)) return false;
    if ((input.selectedPlugins !== undefined || input.selectedTools !== undefined) &&
      !input.selectedPlugins?.includes(spec.pluginId) && !input.selectedTools?.includes(name) && !input.selectedTools?.includes(spec.identity)) return false;
    if (toolSpec(name)?.domainId === "design" && !artifactEnabled()) return false;
    const allowlist = toolSpec(name)?.backendAllowlist;
    return !allowlist || allowlist.some(id => id === input.backend);
  });
}

function admittedTools(input: BuiltinIssuanceInput): PluginToolName[] {
  return admittedAmbientTools(input);
}
