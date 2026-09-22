"use client";

/**
 * [INPUT]: Depends on React, Setup clients, the main-provided startup snapshot, revision-safe snapshots, the shared evidence clock and onboarding gate.
 * [OUTPUT]: Provides a first-render verdict seeded from the startup snapshot (a passive unknown never unseats a provisional Agent), installation-or-deferred onboarding checks, explicit destinations and session locks, full workbench checks, per-Agent feedback and scope-aware coalesced actions.
 * [POS]: Renderer Agent-environment context; the main window owns setup lifecycle while App windows consume only backend runtime projections for their resident chat
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useEvidenceClock } from "./availability/use-evidence-clock";
import { availabilityDeadlines, mergeBackendSnapshots } from "../../../shared/agent-availability/snapshots";
import { projectAvailability } from "../../../shared/agent-availability/projection";
import type { TurnAvailabilityEvidence } from "../../../shared/agent-availability/types";
import { AGENT_BACKEND_ORDER, type AgentBackendId, type BackendInfo } from "../../../shared/agent-ipc";
import type {
  SetupStatus,
  SetupTerminalAction,
  SetupFeedback,
  SetupOperation,
  SetupCheckScope,
} from "../../../shared/setup-ipc";
import {
  checkSetup,
  refreshSetupIfNeeded,
  openBackendTerminalAction,
  onSetupEvent,
  openAgentSettings,
  recheckBackend,
  refreshBackendLatest,
  startupSetupStatus,
} from "@/lib/setup-client";
import { canEnterAgentBackend } from "@/lib/agent-backends";
import { diagnosticFailureDetails } from "../../../shared/product-failure";
import {
  agentRequirement,
  chatHomeRequirement,
  onboardingGate,
  type OnboardingPhase,
  type OnboardingVerdict,
} from "@/lib/onboarding-gate";
import { settingsStore } from "@/lib/settings-store";
import { listBackends } from "@/lib/settings-client";
import { useAppTranslation } from "./i18n-provider";

/* ============================================================
 * 引导没有豁免档。
 *
 * 这里曾有一枚 `setup-seen`，后来换成一枚 DISMISSED——两者都是同一件事：
 * 让「用户按过稍后配置」这个意图跨过判据。产品撤掉那颗按钮之后，记号就只
 * 剩一个身份：渲染进程可写、devtools 够得着的后门。于是一并删掉。
 *
 * e2e 不再靠它跨门：fixture 把机器布置成产品确实可用的样子（目录备好、
 * PATH 末尾兜一枚站位运行时），判据原样成立，测试走的是与用户相同的路。
 * ============================================================ */
/** 入场判据是产品策略，与呈现分离，故住在 lib/agent-backends 并可单测。 */
const isReady = (status: SetupStatus | null) =>
  Boolean(status?.backends.some(canEnterAgentBackend));

/* A passive read answers "unknown" for every backend it has not probed yet, and
   that silence is no evidence against the snapshot this window was handed. A
   provisional entry therefore survives it and falls only to a real verdict
   (installed/missing/unsupported/error) or to a status event from main. */
const mergeReadBackends = (
  current: readonly BackendInfo[],
  incoming: readonly BackendInfo[]
) =>
  mergeBackendSnapshots(
    current,
    incoming.filter(
      (entry) =>
        entry.runtimeStatus !== "unknown" ||
        !current.find((prior) => prior.id === entry.id)?.provisional
    )
  );

type SetupContextValue = {
  status: SetupStatus | null;
  now: number;
  recentTurns?: ReadonlyMap<string, TurnAvailabilityEvidence>;
  openAgentSettings: () => Promise<void>;
  checking: boolean;
  busy: Partial<Record<AgentBackendId, SetupTerminalAction | "recheck">>;
  latestChecking: Partial<Record<AgentBackendId, boolean>>;
  error: SetupFeedback | null;
  feedback: Partial<Record<AgentBackendId, SetupFeedback>>;
  refreshIfNeeded: () => Promise<void>;
  reload: () => Promise<void>;
  ready: boolean;
  onboarding: OnboardingVerdict;
  onboardingTarget?: "agent" | null;
  holdOnboarding: () => void;
  openOnboarding: (target?: "agent") => void;
  leaveOnboarding: () => void;
  terminalAction: (
    backend: AgentBackendId,
    action: SetupTerminalAction
  ) => Promise<void>;
  recheckBackend: (backend: AgentBackendId) => Promise<void>;
  refreshLatest: (backend: AgentBackendId) => Promise<void>;
  recheck: () => Promise<void>;
};

const setupFailure = (operation: SetupOperation, cause: unknown): SetupFeedback => {
  const details = diagnosticFailureDetails(cause);
  return { operation, kind: "failed", diagnostic: details.kind === "diagnostic" ? details.message : undefined };
};

const SetupContext = createContext<SetupContextValue | null>(null);

const APP_RUNTIME_ONBOARDING: OnboardingVerdict = {
  phase: "app",
  facts: { "chat-home": "satisfied", agent: "satisfied" },
  missing: [],
  settled: true,
};

/** App windows receive backend facts and residence-scoped rechecks, plus fixed management navigation. */
export function AppRuntimeSetupProvider({ children }: { children: React.ReactNode }) {
  const { t } = useAppTranslation();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [recentTurns, setRecentTurns] = useState<ReadonlyMap<string, TurnAvailabilityEvidence>>(new Map());
  const now = useEvidenceClock(availabilityDeadlines(status?.backends ?? [], [...recentTurns.values()]));
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<SetupFeedback | null>(null);
  const [feedback] = useState<Partial<Record<AgentBackendId, SetupFeedback>>>({});
  const recheck = useCallback(async () => {
    try {
      const backends = await listBackends();
      setStatus((current) => ({ backends: mergeBackendSnapshots(current?.backends ?? [], backends) }));
      setError(null);
    } catch (cause) {
      setError(setupFailure("load", cause));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    const release = onSetupEvent((event) => {
      if (event.type === "status") setStatus((current) => ({ backends: mergeBackendSnapshots(current?.backends ?? [], [event.status]) }));
      if (event.type === "turn-evidence") setRecentTurns((current) =>
        (current.get(event.evidence.conversationId)?.revision ?? -1) >= event.evidence.revision ? current : new Map(current).set(event.evidence.conversationId, event.evidence));
    });
    const timer = window.setTimeout(() => void recheck(), 0);
    return () => { window.clearTimeout(timer); release(); };
  }, [recheck]);
  const unavailable = useCallback(async () => {
    throw new Error(t("setup.provider.mainWindowOnly"));
  }, [t]);
  const value = useMemo<SetupContextValue>(() => ({
    status, now, recentTurns, openAgentSettings,
    checking,
    busy: {},
    latestChecking: {},
    error,
    feedback,
    ready: isReady(status),
    refreshIfNeeded: recheck, reload: recheck,
    onboarding: APP_RUNTIME_ONBOARDING,
    holdOnboarding: () => undefined,
    openOnboarding: () => undefined,
    leaveOnboarding: () => undefined,
    terminalAction: unavailable,
    recheckBackend: async (backend) => { await recheckBackend(backend); await recheck(); },
    refreshLatest: unavailable,
    recheck: async () => { await Promise.all(AGENT_BACKEND_ORDER.map((backend) => recheckBackend(backend))); await recheck(); },
  }), [checking, error, feedback, recheck, status, unavailable, now, recentTurns]);
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

export function SetupProvider({ children }: { children: React.ReactNode }) {
  /* Provisional facts from the last launch: they let the gate settle on the first
     render, before `setup:check` and `settings:get` have answered. */
  const [status, setStatus] = useState<SetupStatus | null>(startupSetupStatus);
  const [recentTurns, setRecentTurns] = useState<ReadonlyMap<string, TurnAvailabilityEvidence>>(new Map());
  const now = useEvidenceClock(availabilityDeadlines(status?.backends ?? [], [...recentTurns.values()]));
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] =
    useState<SetupContextValue["busy"]>({});
  const [latestChecking, setLatestChecking] =
    useState<SetupContextValue["latestChecking"]>({});
  const [error, setError] = useState<SetupFeedback | null>(null);
  const [feedback, setFeedback] = useState<Partial<Record<AgentBackendId, SetupFeedback>>>({});
  const [forced, setForced] = useState(false);
  const [onboardingTarget, setOnboardingTarget] = useState<"agent" | null>(null);

  /* Chat Home 是引导的另一半门槛，故 Provider 自己保证它被读取——
     此前只有引导页在 mount 后才 ensureLoaded，判据便永远等不到它。 */
  const { settings, error: settingsError } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);

  const recheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const next = await checkSetup();
      setStatus((current) => ({ backends: mergeReadBackends(current?.backends ?? [], next.backends) }));
    } catch (cause) {
      setError(setupFailure("load", cause));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onSetupEvent((event) => {
      if (event.type === "status") {
        setStatus((current) => ({ backends: mergeBackendSnapshots(current?.backends ?? [], [event.status]) }));
      }
      if (event.type === "turn-evidence") setRecentTurns((current) => {
        const next = new Map(current);
        const prior = next.get(event.evidence.conversationId);
        if (!prior || prior.revision < event.evidence.revision) next.set(event.evidence.conversationId, event.evidence);
        return next;
      });
      if (event.type === "latest-version") {
        setLatestChecking((current) => ({
          ...current,
          [event.backend]: event.checking,
        }));
      }
      /* main 侧目录缓存已作废，renderer 侧的"已加载"记忆也必须跟着失效，
         否则用户看到的仍是登录前那份空目录。settingsStore 自带代次隔离，
         在飞的旧请求不会覆盖这次强制重取的结果。 */
      if (event.type === "models-invalidated") {
        settingsStore.retryModels(event.backend);
      }
    });
    const timer = window.setTimeout(() => void recheck(), 0);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [recheck]);

  const chatHomeStatus = chatHomeRequirement(
    settings?.chatHomeState ?? null,
    settingsError
  );
  const agentStatus = agentRequirement(status?.backends ?? null, checking, settings?.agentSetupDeferred);
  /* 守档：事实被瞬态打回未落定时，gate 沿用最近一次由已落定事实亲自
     选出的档位。forced 的强制引导不写档——离场要回到被强制前的界面。
     渲染期就地调整而非 effect 回写，settled 与 held 没有错帧窗口；
     不等式守卫保证至多多渲染一次即收敛。 */
  const [heldPhase, setHeldPhase] = useState<OnboardingPhase>("loading");
  const onboarding = useMemo(
    () =>
      onboardingGate({
        facts: { "chat-home": chatHomeStatus, agent: agentStatus },
        forced,
        held: heldPhase,
      }),
    [chatHomeStatus, agentStatus, forced, heldPhase]
  );
  if (onboarding.settled && !forced && heldPhase !== onboarding.phase) {
    setHeldPhase(onboarding.phase);
  }

  /* 离场只有一种含义了：门槛已补齐，关掉页面。缺口还在时根本走不到这里
     ——主按钮是禁用的，页面也没有别的出口。 */
  const leaveOnboarding = useCallback(() => { setForced(false); setOnboardingTarget(null); }, []);

  const operations = useRef(new Map<AgentBackendId, Promise<void>>());
  const checkScope: SetupCheckScope = onboarding.phase === "app" ? "full" : "installation";
  const automatic = useRef<{ scope: SetupCheckScope; promise: Promise<void> } | null>(null);
  const refreshIfNeeded = useCallback(() => {
    if (automatic.current && (automatic.current.scope === "full" || automatic.current.scope === checkScope)) return automatic.current.promise;
    const task = (automatic.current?.promise ?? Promise.resolve()).then(() => refreshSetupIfNeeded(checkScope)).then((next) => {
      setStatus((current) => ({ backends: mergeReadBackends(current?.backends ?? [], next.backends) }));
      setError(null);
    }).catch((cause) => setError(setupFailure("load", cause))).finally(() => {
      if (automatic.current?.promise === task) automatic.current = null;
    });
    automatic.current = { scope: checkScope, promise: task };
    return task;
  }, [checkScope]);

  useEffect(() => {
    if (onboarding.phase === "app") void refreshIfNeeded();
  }, [onboarding.phase, refreshIfNeeded]);

  const runOperation = useCallback((backend: AgentBackendId, operation: SetupTerminalAction | "recheck") => {
    const existing = operations.current.get(backend);
    if (existing) return existing;
    setBusy((current) => ({ ...current, [backend]: operation }));
    setFeedback((current) => { const next = { ...current }; delete next[backend]; return next; });
    const task = (async () => {
      try {
        if (operation === "recheck") {
          const next = await recheckBackend(backend, checkScope);
          setStatus((current) => ({ backends: mergeReadBackends(current?.backends ?? [], next.backends) }));
          setError(null);
        } else {
          const result = await openBackendTerminalAction(backend, operation, checkScope);
          if (result.delivery === "clipboard" || result.delivery === "clipboard-failed") {
            const kind = result.delivery;
            setFeedback((current) => ({ ...current, [backend]: { operation, kind, diagnostic: result.diagnostic } }));
          }
        }
      } catch (cause) {
        setFeedback((current) => ({ ...current, [backend]: setupFailure(operation === "recheck" ? "check" : operation, cause) }));
      }
    })().finally(() => {
      if (operations.current.get(backend) !== task) return;
      operations.current.delete(backend);
      setBusy((current) => { const next = { ...current }; delete next[backend]; return next; });
    });
    operations.current.set(backend, task);
    return task;
  }, [checkScope]);
  const runTerminal = useCallback((backend: AgentBackendId, operation: SetupTerminalAction) => runOperation(backend, operation), [runOperation]);
  const recheckOne = useCallback((backend: AgentBackendId) => runOperation(backend, "recheck"), [runOperation]);

  const value = useMemo<SetupContextValue>(
    () => ({
      status, now, recentTurns, openAgentSettings,
      checking: checking || Object.values(busy).includes("recheck") ||
        Boolean(status?.backends.some((backend) => backend.authStatus === "checking" || projectAvailability(backend, now).refreshing)),
      busy,
      latestChecking,
      error,
      feedback,
      ready: isReady(status),
      refreshIfNeeded, reload: recheck,
      onboarding,
      onboardingTarget,
      holdOnboarding: () => setForced(true),
      openOnboarding: (target = "agent") => { setOnboardingTarget(target); setForced(true); },
      leaveOnboarding,
      terminalAction: runTerminal,
      recheckBackend: recheckOne,
      refreshLatest: refreshBackendLatest,
      recheck: async () => { await Promise.all(AGENT_BACKEND_ORDER.map(recheckOne)); },
    }),
    [
      status, now, recentTurns,
      checking,
      busy,
      latestChecking,
      error,
      feedback,
      onboarding,
      onboardingTarget,
      leaveOnboarding,
      runTerminal,
      recheckOne, refreshIfNeeded, recheck,
    ]
  );

  return (
    <SetupContext.Provider value={value}>{children}</SetupContext.Provider>
  );
}

export function useSetup() {
  const context = useContext(SetupContext);
  if (!context) throw new Error("useSetup 必须在 SetupProvider 内使用");
  return context;
}
