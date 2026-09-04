/**
 * [INPUT]: Depends on shared ProductFailure, Agent backend identity, and renderer translation functions
 * [OUTPUT]: Provides the single ProductFailure-to-human-copy projection (terminal code copy for danger tone, provider-neutral notice copy for warning tone), safe diagnostic extraction, login commands, and renderer-side fallback construction
 * [POS]: Renderer presentation seam shared by transcript, Setup, Settings, and model-catalog failures
 */

import type { AgentBackendId } from "../../shared/agent-ipc";
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
  type AgentRuntimeFailureCode,
  type ProductFailure,
} from "../../shared/product-failure";

export const AGENT_LOGIN_COMMAND: Record<AgentBackendId, string> = {
  codex: "codex login",
  claude: "claude auth login",
  kimi: "kimi login",
  opencode: "opencode auth login",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type AgentFailureCopy = Readonly<{
  title: string;
  explanation: string;
  resolution: string;
  diagnostic?: string;
}>;

export type AgentSurfaceFailure = Readonly<{
  failure: ProductFailure;
  backend: string;
  backendId?: AgentBackendId;
}>;

export function agentFailureCopy(
  t: Translate,
  failure: ProductFailure,
  options: {
    backend: string;
    backendId?: AgentBackendId;
    tone?: "danger" | "warning";
  }
): AgentFailureCopy {
  if (failure.domain !== "agent-runtime") {
    return {
      title: t(`chat.skillFailure.${failure.code}`),
      explanation: "",
      resolution: "",
    };
  }
  const code = failure.code;
  const values = {
    backend: options.backend,
    command: options.backendId
      ? AGENT_LOGIN_COMMAND[options.backendId]
      : "the Agent login command",
  };
  const diagnostic =
    failure.safeDetails.kind === "diagnostic"
      ? { diagnostic: failure.safeDetails.message }
      : {};
  /* ── warning 是提示，不是死因 ────────────────────────────────────
     code→文案表全是为"这轮为什么没完成"写的（重试、联系支持）。Agent 的
     warning 级 notice 走到这里只说明它想提醒一句，本轮照常进行；套终态
     文案会把一条提醒画成事故。提示的原句留在技术详情里，不翻译不改写。 */
  if (options.tone === "warning") {
    return {
      title: t("agentFailure.notice.title", values),
      explanation: t("agentFailure.notice.explanation", values),
      resolution: "",
      ...diagnostic,
    };
  }
  return {
    title: t(`agentFailure.code.${code}.title`, values),
    explanation: t(`agentFailure.code.${code}.explanation`, values),
    resolution: t(`agentFailure.code.${code}.resolution`, values),
    ...diagnostic,
  };
}

export function rendererAgentFailure(
  code: AgentRuntimeFailureCode,
  cause?: unknown
): ProductFailure {
  return agentRuntimeFailure(
    code,
    cause === undefined ? undefined : diagnosticFailureDetails(cause)
  );
}

export function rendererAgentSurfaceFailure(
  code: AgentRuntimeFailureCode,
  backend: string,
  cause?: unknown,
  backendId?: AgentBackendId
): AgentSurfaceFailure {
  return {
    failure: rendererAgentFailure(code, cause),
    backend,
    ...(backendId ? { backendId } : {}),
  };
}
