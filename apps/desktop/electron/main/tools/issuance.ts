/**
 * [INPUT]: Depends on shared buildtin-tools Access to projection/backend white lists, AgentBackendId and Agent TurnOrigin
 * [OUTPUT]: Provides builtinToolAccess, turnKindForOrigin, projectBuiltinTools and issueBuiltinMcpWhenAllowed; The final issuer can be frozen and then leased
 * [POS]: The tools are a purely combined layer of authorization strategies; None, back-end exclusion and missing origin all fail-closed before the lease was created
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import {
  allowedToolsFor,
  builtinToolSpec,
  type BuiltinToolName,
  type BuiltinTurnKind,
} from "../../../shared/builtin-tools";
import type { TurnOrigin } from "../agent/bridge-types";

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
 * origin 的两个分支各自成桶；缺 origin 按 relay 收窄。
 */
export function turnKindForOrigin(
  origin: TurnOrigin | undefined
): BuiltinTurnKind {
  if (origin?.kind === "manual") return "manual";
  return "relay";
}

export type BuiltinIssuanceInput = {
  builtinTools: "none" | "read" | "mutate";
  backend: AgentBackendId;
  planMode: boolean;
  origin: TurnOrigin | undefined;
  /** 本轮 resolveContext 时冻结的用户偏好；只过滤 ambient 工具。 */
  disabledTools?: readonly string[];
};

export function issueBuiltinMcpWhenAllowed<T>(
  input: BuiltinIssuanceInput,
  issue: (allowedTools: BuiltinToolName[]) => T
) {
  const allowedTools = projectBuiltinTools(input);
  if (allowedTools.length === 0) return undefined;
  return issue(allowedTools);
}

/** runtime CAS 后冻结的最终工具集合；lease 与产品上下文只读这一份结果。 */
export function projectBuiltinTools(
  input: BuiltinIssuanceInput
): BuiltinToolName[] {
  const access = builtinToolAccess(input);
  if (access === "none") return [];
  return admittedTools(input).filter((name) => {
    const allowlist = builtinToolSpec(name)?.backendAllowlist;
    return !allowlist || allowlist.includes(input.backend);
  });
}

/** App instructions 与 lease 共同消费的 ambient 真相；精确签发工具不在其中。 */
export function admittedAmbientTools(
  input: BuiltinIssuanceInput
): BuiltinToolName[] {
  const access = builtinToolAccess(input);
  const turnKind = turnKindForOrigin(input.origin);
  if (access === "none") return [];
  const disabled = new Set(input.disabledTools ?? []);
  return allowedToolsFor(access, turnKind, input.planMode).filter((name) => {
    if (disabled.has(name)) return false;
    const allowlist = builtinToolSpec(name)?.backendAllowlist;
    return !allowlist || allowlist.includes(input.backend);
  });
}

function admittedTools(input: BuiltinIssuanceInput): BuiltinToolName[] {
  return admittedAmbientTools(input);
}
