/**
 * [INPUT]: The canonical Provider catalog, Agent submission contracts and explicit validation dependencies.
 * [OUTPUT]: validateAgentTurnOptions.
 * [POS]: Agent validation options boundary; admission and authority checks stay mandatory.
 */
import { builtinProviderCatalog, knownBackend } from "../../../../shared/providers/catalog";
import type { AgentPermissionMode, AgentTurnOptions } from "../../../../shared/ipc/agent/agent-ipc";
import { backendRegistry, turnBackend } from "../../backends";
import { chatAgentIdSchema, packageTurnOptionsSchema, type ChatTurnOptions, type PackageTurnOptions } from "../../../../shared/chat-agent/options";
import { assertExactKeys } from "./primitives";


export function validateAgentTurnOptions(value: unknown): ChatTurnOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("未知的 Agent 后端");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.backend !== "string") throw new Error("未知的 Agent 后端");
  const backend = knownBackend(builtinProviderCatalog, raw.backend);
  if (!backend) return packageTurnOptions(raw);
  const descriptor = backendRegistry.get(backend)!;
  assertExactKeys(
    value,
    [
      "backend",
      "model",
      "reasoningEffort",
      ...(descriptor.serviceTier ? ["serviceTier"] : []),
      "permissionMode",
    ],
    "Agent turnOptions"
  );
  descriptor.validateTurnOptions(value);
  const permissionMode = raw.permissionMode as AgentPermissionMode;
  /* 必填与可选的差别已由 descriptor.validateTurnOptions 全部说完：codex 缺
     三者任一在上一行就抛掉了，所以这里只剩一条「在场即透传」的投影。多写一
     条按后端字面量分流的返回，第四家来的时候还要再改一次。 */
  return {
    backend,
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    ...(typeof raw.reasoningEffort === "string"
      ? { reasoningEffort: raw.reasoningEffort }
      : {}),
    ...(descriptor.serviceTier && typeof raw.serviceTier === "string"
      ? { serviceTier: raw.serviceTier }
      : {}),
    permissionMode,
  } as AgentTurnOptions;
}

function packageTurnOptions(raw: Record<string, unknown>): PackageTurnOptions { // the Chat record's package shape, only while a backend runs it
  const id = chatAgentIdSchema.safeParse(raw.backend); // a malformed id never reaches the resolver
  if (!id.success) throw new Error("未知的 Agent 后端");
  const backend = turnBackend(id.data), options = packageTurnOptionsSchema.parse(raw); // no backend: the named runtime-unavailable
  backend.validateTurnOptions(options);
  return options;
}
