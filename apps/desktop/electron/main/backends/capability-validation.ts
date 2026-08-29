/**
 * [INPUT]: Depends on BackendDescriptor, AgentSendPayload, runtime, AbortSignal and a credible model directory
 * [OUTPUT]: Provides capability gates plus separate model-identity and opaque-config value contracts
 * [POS]: The backends of the Unified Access Screener; Remove permissions, input, session and model combination examples before transport starts
 */

import type { AgentSendPayload } from "../../../shared/agent-ipc";
import type {
  BackendDescriptor,
  ResolvedAgentInput,
  ResolvedRuntime,
} from "./types";

/** 模型 id 是产品用于目录身份匹配的键，因此保留稳定的 ASCII 词法。 */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
/**
 * ACP 配置值是后端拥有的开放枚举。产品不解释其形状，只限制预算并拒绝
 * 控制字符；Unicode、空格和可打印符号都必须逐字透传。
 */
export const OPAQUE_CONFIG_VALUE_PATTERN = /^[^\p{Cc}\p{Cf}]{1,200}$/u;

export function assertBackendCapabilities(
  backend: BackendDescriptor,
  payload: AgentSendPayload,
  capability: ReturnType<BackendDescriptor["capabilitiesFor"]>
) {
  backend.validateTurnOptions(payload.turnOptions);
  if (!capability.permissionModes.includes(payload.turnOptions.permissionMode)) {
    throw new Error(`${backend.displayName} 不支持所选权限档位`);
  }
  if (payload.planMode && !capability.planMode) {
    throw new Error(`${backend.displayName} 不支持 Plan 模式`);
  }
  if (
    payload.input.some((item) => item.type === "image") &&
    !capability.imageInput
  ) {
    throw new Error(`${backend.displayName} 不支持图片输入`);
  }
  if (!payload.session) return;
  if (!capability.resume) {
    throw new Error(`${backend.displayName} 不支持恢复 session`);
  }
  if (
    payload.session.backend !== backend.id ||
    !backend.validateSessionId(payload.session.id)
  ) {
    throw new Error(`${backend.displayName} session 格式或归属无效`);
  }
}

/**
 * resolved 层的图片闸：admission 与 dispatch/注入之间存在能力漂移窗口，
 * 没有这道闸就是 fail-open。报因按项上的 `resolvedOnly` 分流——把用户自贴的
 * 图说成「Section 附件」是冤枉，反之亦然。
 */
export function assertResolvedInputCapabilities(
  backend: BackendDescriptor,
  input: ResolvedAgentInput["input"],
  capability: ReturnType<BackendDescriptor["capabilitiesFor"]>
) {
  if (capability.imageInput) return;
  const images = input.filter((item) => item.type === "image");
  if (!images.length) return;
  throw new Error(
    images.every((item) => item.resolvedOnly)
      ? `${backend.displayName} 当前不支持 Section 附件图片`
      : `${backend.displayName} 当前不支持图片输入`
  );
}

export async function assertModelCapabilities(
  backend: BackendDescriptor,
  payload: AgentSendPayload,
  runtime: ResolvedRuntime,
  workspace: string,
  signal?: AbortSignal
) {
  const model = "model" in payload.turnOptions
    ? payload.turnOptions.model
    : undefined;
  const capabilities = backend.capabilitiesFor(runtime);
  if (capabilities.modelOptions === "none") {
    if (model !== undefined) {
      throw new Error(`${backend.displayName} 不接受 renderer 指定模型`);
    }
    return;
  }
  if (capabilities.modelOptions !== "list-only") return;
  const effort =
    "reasoningEffort" in payload.turnOptions
      ? payload.turnOptions.reasoningEffort
      : undefined;
  if (model === undefined && effort === undefined) return;
  if (!backend.models) throw new Error(`${backend.displayName} 缺少模型扩展`);
  const models = await backend.models.list(runtime, workspace, signal);
  const candidate = model === undefined
    ? models.find((entry) => entry.isDefault)
    : models.find((entry) => entry.slug === model);
  /* 「没给 model、目录也不声明默认」与「给了一个目录不认识的 model」是两种
     失败。用同一句话报，前者就会顶着"模型不在可信候选列表中"出现——而用户
     一个模型都没选过。目录不声明默认是合法设计（OpenCode：默认在用户自己的
     config 里），这时该说的是缺 model，不是 model 不可信。 */
  if (!candidate) {
    throw new Error(
      model === undefined
        ? `${backend.displayName} 未指定模型且目录无默认模型，无法校验 Effort`
        : `${backend.displayName} 模型不在可信候选列表中`
    );
  }
  if (
    effort &&
    !candidate.supportedReasoningEfforts?.some(
      (entry) => entry.effort === effort
    )
  ) {
    throw new Error(`${backend.displayName} Effort 不受当前模型支持`);
  }
}
