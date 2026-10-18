/**
 * [INPUT]: Uses canonical Provider identity, the native bridge model query, CLI/config file identities and shared model catalog cache.
 * [OUTPUT]: Exports codexModelCatalog/createCodexModelCatalog with native pagination, efforts and service tiers.
 * [POS]: Main-owned catalog boundary; protocol and process execution remain on the custody-backed native bridge.
 */
import { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { createModelCatalog, executableFileKey, type ModelCatalog } from "../../../backends/models/model-catalog";
import type { ResolvedRuntime } from "../../../backends/contracts/types";
import { MODEL_ID_PATTERN, OPAQUE_CONFIG_VALUE_PATTERN } from "../../../backends/runtime/capability-validation";
import { readNativeModels } from "../../host/turns/bridged-native";
import { nativeCodexLaunch } from "../native/policy/spawn";
import { codexEnvironment } from "../environment";

const family = (runtime: ResolvedRuntime) => {
  const env = codexEnvironment(runtime), home = env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex");
  return ["bb-native-v1:model-list:1", executableFileKey(runtime.executable), runtime.version,
    executableFileKey(join(home, "auth.json")), executableFileKey(join(home, "config.toml")), home, ""].join("\0");
};
export function createCodexModelCatalog(dependencies: { read?: typeof readNativeModels; now?: () => number; ttlMs?: number } = {}): ModelCatalog<ResolvedRuntime> {
  return createModelCatalog({ backend: "codex", label: "Codex model directory", family,
    key: (runtime, workspace) => family(runtime) + workspace,
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.ttlMs === undefined ? {} : { ttlMs: dependencies.ttlMs }),
    read: async (runtime, workspace, signal): Promise<BackendModelInfo[]> => {
      const models = await (dependencies.read ?? readNativeModels)(BUILTIN_PROVIDER_IDS.codex, runtime, nativeCodexLaunch(runtime, workspace), signal);
      const seen = new Set<string>();
      const result = models.filter(model => !model.hidden).map(model => {
        if (!MODEL_ID_PATTERN.test(model.model) || seen.has(model.model)) throw new Error("Native model identity is invalid");
        seen.add(model.model);
        const efforts = model.supportedReasoningEfforts;
        if (!Array.isArray(efforts) || efforts.length > 32 || efforts.some(e => !OPAQUE_CONFIG_VALUE_PATTERN.test(e.reasoningEffort)) ||
          !efforts.some(e => e.reasoningEffort === model.defaultReasoningEffort)) throw new Error("Native model effort directory is invalid");
        return { inputModalities: model.inputModalities, slug: model.model, displayName: model.displayName || model.model, isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: efforts.map(e => ({ effort: e.reasoningEffort, description: e.description })),
          serviceTiers: [{ id: "default", displayName: "Standard" }, ...(model.serviceTiers ?? []).filter(t => t.id !== "default").map(t => ({ id: t.id, displayName: t.name }))] };
      });
      if (!result.length || result.filter(m => m.isDefault).length !== 1) throw new Error("Native model directory must identify one default model");
      return result;
    },
  });
}
export const codexModelCatalog = createCodexModelCatalog();
