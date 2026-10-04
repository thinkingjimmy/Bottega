/**
 * [INPUT]: Depends on shared Agent identity, shared BackendInfo, pure availability projections and the Provider catalog snapshot.
 * [OUTPUT]: Provides backend identity, isBuiltinBackendInfo (the built-in setup facts; a package Provider's have no setup, update, guide or maintenance), the catalog-driven list order (orderedProviders), provider names, states and defaults, the runnable picker order (the stored order narrowed to runnable Agents), shared admission helpers and the title-Agent option list over the catalog with its notices; first checks wait while same-environment background checks preserve eligibility.
 * [POS]: apps/desktop/src/lib/agent; The renderer's single source of backend presentation truth; Composer, Sidebar, Header, and Settings never hard-code backend icons or readiness rules
 */
import { projectAvailability, submissionDecision } from "../../../shared/agent-availability/projection";
import type { AvailabilityState } from "../../../shared/agent-availability/types";


import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type BackendInfo,
  type BuiltinBackendInfo,
  type HeadlessPurpose,
} from "../../../shared/ipc/agent/agent-ipc";
import type { ProviderCatalogSnapshot } from "../../../shared/providers/catalog-ipc";
import type { AppSettings } from "../../../shared/ipc/settings/settings-ipc";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";
import { firstProviderId, isAgentBackendId, type ProviderEntry } from "../provider-catalog/store";

type SavedOrder = Pick<AppSettings, "providerOrder"> | null | undefined;

export { firstProviderId, isAgentBackendId } from "../provider-catalog/store";
/** A built-in's setup facts; a package Provider's share the status list but have no setup, update, guide or maintenance. */
export const isBuiltinBackendInfo = (backend: BackendInfo): backend is BuiltinBackendInfo => isAgentBackendId(backend.id);

/** The user's picker order of runnable Agents; the stored order also keeps Providers this build cannot run (TASK-11 S3-c), which a picker
    leaves out. Settings are always normalized by main, so null only means "not loaded yet". */
export const providerOrder = (settings: Pick<AppSettings, "providerOrder"> | null | undefined): readonly AgentBackendId[] =>
  settings ? settings.providerOrder.filter(isAgentBackendId) : AGENT_BACKEND_ORDER;

/**
 * Every catalog entry once: those the user ordered first in their saved order, the rest after them in catalog order.
 * A saved id the catalog no longer lists is skipped; a package Provider that has gone stays, as an unavailable entry.
 */
export function orderedProviders(settings: SavedOrder, snapshot: ProviderCatalogSnapshot): readonly ProviderEntry[] {
  const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const saved = (settings?.providerOrder ?? []).flatMap((id) => byId.get(id) ?? []);
  const seen = new Set(saved.map((entry) => entry.id));
  return [...saved, ...snapshot.entries.filter((entry) => !seen.has(entry.id))];
}

/** The catalog's built-ins: the Providers whose CLI Setup installs, signs in and rechecks; a package Provider needs no CLI setup. */
export const builtinProviderIds = (snapshot: ProviderCatalogSnapshot): AgentBackendId[] =>
  snapshot.entries.flatMap((entry) => entry.source === "builtin" && isAgentBackendId(entry.id) ? [entry.id] : []);

/** A Chat's Agent by id: the catalog's name when it lists the id, else the built-in label (a gone Provider keeps its bare id). */
export const providerDisplayName = (id: string, snapshot: ProviderCatalogSnapshot) => {
  const entry = snapshot.entries.find((candidate) => candidate.id === id);
  return entry ? providerName(entry) : backendLabel(id);
};

/** A built-in keeps its product name; a package Provider shows the name its descriptor declares, never its id. */
export const providerName = (entry: Pick<ProviderEntry, "id" | "source" | "displayName">) =>
  entry.source === "builtin" ? backendLabel(entry.id) : entry.displayName;

/**
 * A catalog entry that cannot be chosen reads Unavailable whatever its runtime facts, and so does a Provider this surface cannot run
 * (`runnable` false): a Ready row that cannot be chosen is a false status. By default only a built-in is runnable; the Agent selector
 * also runs a package Provider in a draft Chat and in its own Chat. A package Provider with no Setup facts is never "Checking".
 */
export const providerState = (entry: Pick<ProviderEntry, "id" | "available">, backend: BackendInfo | undefined, now: number,
  runnable = isAgentBackendId(entry.id)): AvailabilityState =>
  !entry.available || !runnable || (!backend && !isAgentBackendId(entry.id)) ? "unavailable" : projectAvailability(backend, now).state;

/**
 * Whether a new Chat may start on this Provider now: a built-in always (a missing one shows its setup prompt, as before), a package
 * Provider only while the catalog lists it available and Setup reports it installed, supported and admitted (the selector's own rule).
 */
export function canStartOn(entry: ProviderEntry | undefined, backend: BackendInfo | undefined, now: number) {
  if (!entry) return false;
  if (isAgentBackendId(entry.id)) return true;
  return providerState(entry, backend, now, true) !== "unavailable" && submissionDecision(backend, now).decision === "allow";
}

/** Where a new draft starts: the default Agent when it can start now, else the first Provider in the person's order that can. */
export function draftStartProvider(defaultId: string, settings: SavedOrder, snapshot: ProviderCatalogSnapshot,
  backends: readonly BackendInfo[] | undefined, now: number): string {
  const can = (entry: ProviderEntry) => canStartOn(entry, backends?.find((info) => info.id === entry.id), now);
  const preferred = snapshot.entries.find((entry) => entry.id === defaultId);
  if (preferred && can(preferred)) return defaultId;
  return orderedProviders(settings, snapshot).find(can)?.id ?? firstProviderId(snapshot);
}

export { backendLabel };

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
  backend: Pick<BuiltinBackendInfo, "id" | "runtimeStatus">
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
  id: string;
  name: string;
  notice?: AvailabilityState;
  /** Only an available entry main can store is offered; the others stay listed with their notice. */
  selectable: boolean;
};

/** Every catalog entry that can title a Chat, always, in catalog order — each with its own notice. */
export const titleAgentOptions = (
  backends: BackendInfo[] | undefined,
  snapshot: ProviderCatalogSnapshot,
  now = Date.now()
): TitleAgentOption[] =>
  snapshot.entries.filter((entry) => entry.purposes.title !== "unsupported").map((entry) => {
    const backend = backends?.find((info) => info.id === entry.id);
    const notice = providerState(entry, backend, now) === "unavailable" ? "unavailable" : titleAgentNotice(backend, now);
    const option = { id: entry.id, name: providerName(entry), selectable: entry.available };
    return notice ? { ...option, notice } : option;
  });

export const maintenanceCapableBackends = (backends: BackendInfo[], now = Date.now()) =>
  backends.filter(isBuiltinBackendInfo).filter(
    (backend) =>
      backend.runtimeStatus === "installed" &&
      backend.capabilities.maintenance &&
      MAINTENANCE_PURPOSES.every((purpose) =>
        backend.capabilities.headless.includes(purpose) &&
        purposeAvailable(backend, purpose, now)
      )
  );

export { AgentBackendIcon } from "@ai-chat/ui/components/identity/agent";
