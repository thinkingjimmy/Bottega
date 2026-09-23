/**
 * [INPUT]: Depends on shared Agent identity, shared BackendInfo and pure availability projections.
 * [OUTPUT]: Provides backend identity, the user picker order, shared admission helpers and the always-complete title-Agent option list with its confirmed-blocker notices; first checks wait while same-environment background checks preserve eligibility.
 * [POS]: The renderer's single source of backend presentation truth; Composer, Sidebar, Header, and Settings never hard-code backend icons or readiness rules
 */
import { projectAvailability, submissionDecision } from "../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../shared/agent-availability/types";


import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type BackendInfo,
  type HeadlessPurpose,
} from "../../shared/agent-ipc";
import type { AppSettings } from "../../shared/settings-ipc";

/** The user's picker order; settings are always normalized by main, so null only means "not loaded yet". */
export const providerOrder = (settings: Pick<AppSettings, "providerOrder"> | null | undefined): readonly AgentBackendId[] =>
  settings?.providerOrder ?? AGENT_BACKEND_ORDER;

export const isAgentBackendId = (value: string): value is AgentBackendId =>
  (AGENT_BACKEND_ORDER as readonly string[]).includes(value);

export { backendLabel } from "@ai-chat/ui/components/identity/agent";

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

/**
 * Startup waits for an active auth probe; an inconclusive result remains usable.
 * A provisional entry is last launch's belief, so it opens the onboarding gate but
 * never counts as admission evidence — installing an App or entering a workbench
 * needs a CLI this launch actually found.
 */
export const canEnterAgentBackend = (backend: BackendInfo) =>
  !backend.provisional &&
  (backend.authStatus !== "checking" || backend.availability?.lastCheckedAt !== undefined) &&
  !backend.setupAction && submissionDecision(backend, Date.now()).decision === "allow";

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

/**
 * Every backend is always selectable as the title Agent, so the row carries a
 * readiness notice instead of hiding choices: a confirmed blocker names itself
 * (localized from the shared availability vocabulary), while a backend that is
 * merely still being checked stays neutral rather than claiming a fault.
 */
export const titleAgentNotice = (
  backend: BackendInfo | undefined,
  now = Date.now()
): AvailabilityState | undefined =>
  backend && submissionDecision(backend, now).decision === "block"
    ? projectAvailability(backend, now).state
    : undefined;

export type TitleAgentOption = {
  id: AgentBackendId;
  notice?: AvailabilityState;
};

/** All four backends, always, in the canonical order — each with its own notice. */
export const titleAgentOptions = (
  backends: BackendInfo[] | undefined,
  now = Date.now()
): TitleAgentOption[] =>
  AGENT_BACKEND_ORDER.map((id) => {
    const notice = titleAgentNotice(
      backends?.find((backend) => backend.id === id),
      now
    );
    return notice ? { id, notice } : { id };
  });

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

export { AgentBackendIcon, type AgentIconTone } from "@ai-chat/ui/components/identity/agent";
