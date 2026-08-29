"use client";

/**
 * [INPUT]: Depends on React Context, setup-client, the Settings store, the narrow backend projection, onboarding-gate judgments, and shared SetupStatus
 * [OUTPUT]: Provides full SetupProvider, residence-scoped AppRuntimeSetupProvider, and useSetup for Chat/Settings/onboarding consumers
 * [POS]: Renderer Agent-environment context; the main window owns setup lifecycle while App windows consume only backend runtime projections for their resident chat
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  SetupStatus,
  SetupTerminalAction,
} from "../../../shared/setup-ipc";
import {
  checkSetup,
  openBackendTerminalAction,
  onSetupEvent,
  recheckBackend,
  refreshBackendLatest,
} from "@/lib/setup-client";
import { canEnterAgentBackend } from "@/lib/agent-backends";
import { errorMessage } from "@/lib/errors";
import {
  agentRequirement,
  chatHomeRequirement,
  onboardingGate,
  type OnboardingPhase,
  type OnboardingVerdict,
} from "@/lib/onboarding-gate";
import { settingsStore } from "@/lib/settings-store";
import { listBackends } from "@/lib/settings-client";

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

type SetupContextValue = {
  status: SetupStatus | null;
  checking: boolean;
  busy: Partial<Record<AgentBackendId, SetupTerminalAction | "recheck">>;
  latestChecking: Partial<Record<AgentBackendId, boolean>>;
  error: string;
  ready: boolean;
  onboarding: OnboardingVerdict;
  openOnboarding: () => void;
  leaveOnboarding: () => void;
  terminalAction: (
    backend: AgentBackendId,
    action: SetupTerminalAction
  ) => Promise<void>;
  recheckBackend: (backend: AgentBackendId) => Promise<void>;
  refreshLatest: (backend: AgentBackendId) => Promise<void>;
  recheck: () => Promise<void>;
};

const SetupContext = createContext<SetupContextValue | null>(null);

const APP_RUNTIME_ONBOARDING: OnboardingVerdict = {
  phase: "app",
  facts: { "chat-home": "satisfied", agent: "satisfied" },
  missing: [],
  settled: true,
};

/** App windows never acquire setup/settings authority; they only refresh backend facts. */
export function AppRuntimeSetupProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setStatus({ backends: await listBackends() });
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "Agent 检测失败"));
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void recheck(), 0);
    return () => window.clearTimeout(timer);
  }, [recheck]);
  const unavailable = async () => {
    throw new Error("请在主窗口管理 Agent 环境");
  };
  const value = useMemo<SetupContextValue>(() => ({
    status,
    checking,
    busy: {},
    latestChecking: {},
    error,
    ready: isReady(status),
    onboarding: APP_RUNTIME_ONBOARDING,
    openOnboarding: () => undefined,
    leaveOnboarding: () => undefined,
    terminalAction: unavailable,
    recheckBackend: async () => recheck(),
    refreshLatest: unavailable,
    recheck,
  }), [checking, error, recheck, status]);
  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
}

export function SetupProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] =
    useState<SetupContextValue["busy"]>({});
  const [latestChecking, setLatestChecking] =
    useState<SetupContextValue["latestChecking"]>({});
  const [error, setError] = useState("");
  const [forced, setForced] = useState(false);

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
    setError("");
    try {
      setStatus(await checkSetup());
    } catch (cause) {
      setError(errorMessage(cause, "Agent 检测失败"));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onSetupEvent((event) => {
      if (event.type === "status") {
        setStatus((current) => ({
          backends: current
            ? current.backends.map((backend) =>
                backend.id === event.backend ? event.status : backend
              )
            : [event.status],
        }));
      }
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
  const agentStatus = agentRequirement(status?.backends ?? null, checking);
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
  const leaveOnboarding = useCallback(() => setForced(false), []);

  const runTerminal = useCallback(
    async (backend: AgentBackendId, operation: SetupTerminalAction) => {
      setBusy((current) => ({ ...current, [backend]: operation }));
      setError("");
      try {
        const result = await openBackendTerminalAction(backend, operation);
        if (result.delivery === "clipboard") {
          setError("终端不可用，命令已复制到剪贴板。");
        }
      } catch (cause) {
        setError(errorMessage(cause, `${backend} 终端动作失败`));
      } finally {
        setBusy((current) => {
          const next = { ...current };
          delete next[backend];
          return next;
        });
      }
    },
    []
  );

  const recheckOne = useCallback(async (backend: AgentBackendId) => {
    setBusy((current) => ({ ...current, [backend]: "recheck" }));
    setError("");
    try {
      setStatus(await recheckBackend(backend));
    } catch (cause) {
      setError(errorMessage(cause, `${backend} 重新检测失败`));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[backend];
        return next;
      });
    }
  }, []);

  const value = useMemo<SetupContextValue>(
    () => ({
      status,
      checking,
      busy,
      latestChecking,
      error,
      ready: isReady(status),
      onboarding,
      openOnboarding: () => setForced(true),
      leaveOnboarding,
      terminalAction: runTerminal,
      recheckBackend: recheckOne,
      refreshLatest: refreshBackendLatest,
      recheck,
    }),
    [
      status,
      checking,
      busy,
      latestChecking,
      error,
      onboarding,
      leaveOnboarding,
      runTerminal,
      recheckOne,
      recheck,
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
