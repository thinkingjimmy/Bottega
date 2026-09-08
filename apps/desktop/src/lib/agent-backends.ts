/**
 * [INPUT]: Depends on React, inline brand logos, shared BackendInfo and pure availability projections.
 * [OUTPUT]: Provides fixed backend identities, sendable candidates, startup admission, shared status predicates and purpose-qualified title/maintenance choices; branding stays independent of health.
 * [POS]: The renderer's single source of backend presentation truth; Composer, Sidebar, Header, and Settings never hard-code backend icons or readiness rules
 */
import { projectAvailability, submissionDecision } from "../../shared/agent-availability/projection";


import { createElement, type ComponentProps } from "react";
import { AGENT_LOGO_MARKUP } from "../../../../packages/model-logos/inline";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type BackendInfo,
  type HeadlessPurpose,
} from "../../shared/agent-ipc";

const labels: Record<AgentBackendId, string> = {
  codex: "Codex",
  claude: "Claude",
  kimi: "Kimi",
  opencode: "OpenCode",
};

/* ============================================================
 * 标记内联进 DOM，而不是当 background/mask 贴上去——`currentColor` 只有在
 * 宿主文档里才有主人。于是四枚资产各自自陈其色：claude 通体品牌橙，kimi
 * 主体随语境 + 品牌蓝点，openai/opencode 本无颜色可言故通体随语境。
 *
 * 「这张图能不能上品牌色」曾是图形表里的一列布尔，也曾在组件里换来一个
 * mask/background 分支。内联之后两者一起消失了：没有降级要判，因为没有
 * 谁需要降级。
 * ============================================================ */

/* 资产带 `width/height="1em"` 与 `<title>`：前者会压过调用方的 `size-*`，
   后者会在 hover 时冒出一个原生 tooltip，与我们自己的 tooltip 打架。
   装配时一次性剥掉，运行期不再有人记得这回事。 */
const inlineLogo = (markup: string) =>
  markup
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/ (?:width|height)="1em"/g, "");

const logos: Record<AgentBackendId, string> = {
  codex: inlineLogo(AGENT_LOGO_MARKUP.codex),
  claude: inlineLogo(AGENT_LOGO_MARKUP.claude),
  kimi: inlineLogo(AGENT_LOGO_MARKUP.kimi),
  opencode: inlineLogo(AGENT_LOGO_MARKUP.opencode),
};

export const isAgentBackendId = (value: string): value is AgentBackendId =>
  (AGENT_BACKEND_ORDER as readonly string[]).includes(value);

export const backendLabel = (backend: AgentBackendId) => labels[backend];

export const sendableAgentBackends = (backends: BackendInfo[]) =>
  backends.filter((backend) => submissionDecision(backend, Date.now()).decision === "allow");

export const agentSelectionEnabled = (
  backends: BackendInfo[],
  locked: boolean
) => !locked && sendableAgentBackends(backends).length > 0;

/* 能力门禁只反映 descriptor 已开放的维护 purpose；具体围栏与风险例外由 main 负责 */
const MAINTENANCE_PURPOSES: HeadlessPurpose[] = [
  "install-analysis",
  "repair",
  "serve",
];

/** Startup waits for an active auth probe; an inconclusive result remains usable. */
export const canEnterAgentBackend = (backend: BackendInfo) =>
  backend.authStatus !== "checking" && submissionDecision(backend, Date.now()).decision === "allow";

/**
 * 该不该给登录入口。这是一个确凿结论，不是"除已登录之外的一切"：
 * 把恒为 unknown 的后端渲染成待登录，等于对用户撒一个它自己也无法
 * 证实的谎。error 由状态徽章自陈，unknown 保持中性。
 */
export const needsBackendLogin = (backend: BackendInfo) =>
  projectAvailability(backend, Date.now()).state === "sign-in";

/** Confirmed submission blockers only; inconclusive authentication stays neutral. */
export const backendUnavailable = (backend: BackendInfo) =>
  submissionDecision(backend, Date.now()).decision === "block";

const BACKEND_GUIDE_KEYS = {
  codex: { install: "setup.guide.codex.install", login: "setup.guide.codex.login" },
  claude: { install: "setup.guide.claude.install", login: "setup.guide.claude.login" },
  kimi: { install: "setup.guide.kimi.install", login: "setup.guide.kimi.login" },
  opencode: { install: "setup.guide.opencode.install", login: "setup.guide.opencode.login" },
} as const satisfies Record<AgentBackendId, Record<"install" | "login", string>>;

/**
 * 该装还是该登，是 runtimeStatus 的函数——installed 是唯一"该登录"的状态，
 * 其余（missing/unsupported/error）一律"该装"。这个判断曾住在 main 里，
 * 结果是产品指令被烤成一门语言随 IPC 送来；呈现层手里本就有这一位，取键
 * 即可，诊断原文（`reason`）则始终保持 CLI 说的样子。
 */
export const backendGuideKey = (
  backend: Pick<BackendInfo, "id" | "runtimeStatus">
) =>
  BACKEND_GUIDE_KEYS[backend.id][
    backend.runtimeStatus === "installed" ? "login" : "install"
  ];

function purposeAvailable(backend: BackendInfo, purpose: HeadlessPurpose, now: number) {
  const evidence = backend.availability?.purposeEligibility?.[purpose];
  return evidence ? evidence.decision === "allow" && (evidence.expiresAt === undefined || evidence.expiresAt > now)
    : backend.authStatus === "authenticated";
}

const titleCapableBackends = (backends: BackendInfo[], now: number) =>
  backends.filter(
    (backend) =>
      backend.runtimeStatus === "installed" &&
      backend.capabilities.headless.includes("title") &&
      purposeAvailable(backend, "title", now)
  );

export type TitleAgent = AgentBackendId | "auto";

export const titleAgentOptions = (
  backends: BackendInfo[] | undefined,
  now = Date.now()
): TitleAgent[] => [
  "auto",
  ...titleCapableBackends(backends ?? [], now).map((backend) => backend.id),
];

/**
 * 已持久化的选择可能因后端下线、登出或能力收缩而失效——呈现回落到
 * Auto，但**绝不写回档案**：用户没做任何选择，磁盘上的偏好不该被一次
 * 渲染悄悄改写。`backends` 未到达（undefined）时同样不判失效，
 * 「还不知道」不是「不可用」。
 */
export const effectiveTitleAgent = (
  persisted: TitleAgent | undefined,
  backends: BackendInfo[] | undefined,
  now = Date.now()
): TitleAgent => {
  if (!persisted) return "auto";
  if (!backends) return persisted;
  return titleAgentOptions(backends, now).includes(persisted) ? persisted : "auto";
};

export const maintenanceCapableBackends = (backends: BackendInfo[], now = Date.now()) =>
  backends.filter(
    (backend) =>
      backend.runtimeStatus === "installed" &&
      backend.capabilities.maintenance &&
      MAINTENANCE_PURPOSES.every((purpose) =>
        backend.capabilities.headless.includes(purpose) &&
        purposeAvailable(backend, purpose, now)
      )
  );

/** Brand identity is independent of health; mono remains an explicit visual option. */
export type AgentIconTone = "brand" | "mono";

export function AgentBackendIcon({
  backend,
  tone = "brand",
  className,
  ...props
}: {
  backend: AgentBackendId;
  tone?: AgentIconTone;
} & ComponentProps<"span">) {
  const labelled = Boolean(props["aria-label"]);
  return createElement("span", {
    ...props,
    "aria-hidden": labelled ? undefined : true,
    role: props.role ?? (labelled ? "img" : undefined),
    /* CSS 的 fill 压得过资产里的 fill 呈现属性，故 mono 无需第二份图形。 */
    className: `inline-block shrink-0 [&>svg]:block [&>svg]:size-full ${
      tone === "mono" ? "[&_*]:fill-current " : ""
    }${className ?? ""}`,
    dangerouslySetInnerHTML: { __html: logos[backend] },
  });
}
