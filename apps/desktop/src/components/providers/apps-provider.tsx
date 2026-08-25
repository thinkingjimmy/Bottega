"use client";

/**
 * [INPUT]: Depends on react Context, shared AppRecord/PresetAppSummary and apps-client
 * [OUTPUT]: Provides AppsProvider/useApps/useOptionalApps, presets list with one-click installation, Saves as App/ renames/durable chat slots, double-character re-binding, rejects old revision Agent visibility and three warnings
 * [POS]: The Apps of providers are a single source of truth, with a combined record, operation, mode and monotonous visibility according to appId; The fact that the new turn is not covered by the late attempt
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AddAppInput,
  AppAgentVisibility,
  AppRecord,
  AppOperation,
  AppRuntimeState,
  EnsureAppChatSlotInput,
  EnsureAppChatSlotResult,
  InstallPresetInput,
  PresetAppSummary,
  PresetProbeResult,
  RemoveAppMode,
  RenameAppInput,
  SaveAsAppInput,
  SetAppAgentInput,
} from "../../../shared/apps-ipc";
import {
  addApp as addAppViaBridge,
  cancelAppInstall,
  discardPresetAppProbe,
  hasAppsBridge,
  installPresetApp,
  probePresetApp,
  listApps,
  listPresetApps,
  onAppsEvent,
  removeApp,
  renameApp,
  repairApp,
  retryApp,
  revealApp,
  saveAsApp,
  setAppAgent,
  ensureAppChatSlot,
  retryAppSkill,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { normalizeGithubRepoUrl as sharedNormalizeGithubRepoUrl } from "../../../shared/github-repo";

type AppInfo = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  icon: string;
};

type AppState = AppRecord["state"];
type AppsResultNotice = "error" | "success" | null;
export type AppsSidebarStatus = "loading" | AppsResultNotice;

const workingStates: AppState[] = ["creating", "installing", "updating"];
const failedStates: AppState[] = [
  "install-failed",
  "update-failed",
];

function noticeForTransition(
  previous: AppState | undefined,
  record: AppRecord
): AppsResultNotice {
  if (
    failedStates.includes(record.state) &&
    record.lastError?.message !== "用户取消"
  ) {
    return "error";
  }
  return record.state === "ready" &&
    previous !== undefined &&
    workingStates.includes(previous)
    ? "success"
    : null;
}

export type AppListItem =
  | ({ kind: "placeholder" } & AppInfo)
  | {
      kind: "installed";
      record: AppRecord;
      step: string;
      operation?: AppOperation;
      runtimeState?: AppRuntimeState;
    };

type AppsContextValue = {
  apps: AppListItem[];
  records: AppRecord[];
  presets: PresetAppSummary[];
  /** 三段协议：probe 冻结 → 用户确认 → install 携带 preflightId+digest；放弃即 discard */
  probePreset: (presetId: string) => Promise<PresetProbeResult>;
  installPreset: (input: InstallPresetInput) => Promise<AppRecord>;
  discardPresetProbe: (preflightId: string) => Promise<void>;
  loading: boolean;
  /** 列表没拉回来（renderer 侧 IPC 失败）：视图层不得据此宣称「还没有 App」 */
  listWarning: string;
  /** 网关降级：与「有哪些 App」无关，走页面横幅 */
  runtimeWarning: string;
  /** 逐 conversation 的「上一轮 Agent 看不见什么」，与页面级 warning 不同槽 */
  agentVisibility: Record<string, AppAgentVisibility>;
  highlightedId: string;
  liveLogs: Record<string, string[]>;
  sidebarStatus: AppsSidebarStatus;
  addApp: (input: AddAppInput) => Promise<AppRecord | AppInfo>;
  setAgent: (input: SetAppAgentInput) => Promise<AppRecord>;
  saveAsApp: (input: SaveAsAppInput) => Promise<AppRecord>;
  renameApp: (input: RenameAppInput) => Promise<AppRecord>;
  ensureChatSlot: (
    input: EnsureAppChatSlotInput
  ) => Promise<EnsureAppChatSlotResult>;
  retrySkill: (appId: string) => Promise<AppRecord>;
  removeApp: (appId: string, mode?: RemoveAppMode) => Promise<void>;
  retryApp: (appId: string) => Promise<void>;
  repairApp: (appId: string) => Promise<void>;
  cancelInstall: (appId: string) => Promise<void>;
  revealApp: (appId: string) => Promise<void>;
  highlightApp: (appId: string) => void;
  acknowledgeSidebarStatus: () => void;
};

const AppsContext = createContext<AppsContextValue | null>(null);

/** 归一化单源在 shared；renderer 侧历史消费的是纯 URL 字符串，这里收窄投影。 */
export function normalizeGithubRepoUrl(value: string) {
  return sharedNormalizeGithubRepoUrl(value).repoUrl;
}

export function AppsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [presets, setPresets] = useState<PresetAppSummary[]>([]);
  const recordStates = useRef(new Map<string, AppState>());
  const [browserApps, setBrowserApps] = useState<AppInfo[]>([]);
  const [steps, setSteps] = useState<Record<string, string>>({});
  const [operations, setOperations] = useState<Record<string, AppOperation>>({});
  const [runtimeStates, setRuntimeStates] = useState<
    Record<string, AppRuntimeState>
  >({});
  const [liveLogs, setLiveLogs] = useState<Record<string, string[]>>({});
  const [listWarning, setListWarning] = useState("");
  const [runtimeWarning, setRuntimeWarning] = useState("");
  const [agentVisibility, setAgentVisibility] = useState<
    Record<string, AppAgentVisibility>
  >({});
  const [highlightedId, setHighlightedId] = useState("");
  const [resultNotice, setResultNotice] =
    useState<AppsResultNotice>(null);
  const [loading, setLoading] = useState(hasAppsBridge());

  useEffect(() => {
    if (!hasAppsBridge()) return;
    let active = true;
    const unsubscribe = onAppsEvent((event) => {
      if (!active) return;
      if (event.type === "runtime-warning") {
        setRuntimeWarning(event.message);
      } else if (event.type === "agent-visibility") {
        /* 旧 attempt 可能晚到；revision 是 conversation 内唯一覆盖资格。 */
        setAgentVisibility((current) => {
          const previous = current[event.visibility.conversationId];
          if (previous && previous.revision >= event.visibility.revision) return current;
          return {
            ...current,
            [event.visibility.conversationId]: event.visibility,
          };
        });
      } else if (event.type === "status") {
        const notice = noticeForTransition(
          recordStates.current.get(event.appId),
          event.record
        );
        recordStates.current.set(event.appId, event.record.state);
        if (notice) {
          setResultNotice((current) =>
            notice === "error" || current === "error" ? "error" : notice
          );
        }
        setRecords((current) => [
          ...current.filter((record) => record.id !== event.appId),
          event.record,
        ]);
      } else if (event.type === "removed") {
        recordStates.current.delete(event.appId);
        setRecords((current) =>
          current.filter((record) => record.id !== event.appId)
        );
      } else if (event.type === "progress") {
        setSteps((current) => ({ ...current, [event.appId]: event.step }));
        setOperations((current) => ({
          ...current,
          [event.appId]: event.operation,
        }));
      } else if (event.type === "runtime") {
        setRuntimeStates((current) => ({
          ...current,
          [event.appId]: event.state,
        }));
      } else if (event.type === "log") {
        setLiveLogs((current) => ({
          ...current,
          [event.appId]: [
            ...(current[event.appId] ?? []).slice(-499),
            event.line,
          ],
        }));
      }
    });
    void listApps()
      .then((snapshot) => {
        if (!active) return;
        recordStates.current = new Map(
          snapshot.apps.map((record) => [record.id, record.state])
        );
        setRecords(snapshot.apps);
        setRuntimeWarning(snapshot.runtimeWarning ?? "");
      })
      .catch((cause) => {
        /* 列表整条没拉回来。records 于是是空的，但「空」在这里的意思是
         * 「没读到」而不是「用户没装」——这条 warning 的唯一职责就是让
         * 视图层区分这两者，别把一次 IPC 失败讲成用户的现状。
         * main 侧不存在对应槽位：主档损坏时 AppStore 直接 fail-closed。 */
        if (active) {
          setListWarning(errorMessage(cause, "Apps 加载失败"));
        }
      })
      .finally(() => active && setLoading(false));
    /* 预设目录是 main 内的编译期常量，唯一失败面是 IPC 桥缺席——与 listApps
     * 同一故障类，页面级告警由它承担，这里降级记录即可。 */
    void listPresetApps()
      .then((summaries) => active && setPresets(summaries))
      .catch((cause) => {
        console.warn(
          `[apps] ${errorMessage(cause, "预设 App 清单读取失败")}`
        );
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const addApp = useCallback(async (input: AddAppInput) => {
    const repoUrl = normalizeGithubRepoUrl(input.repoUrl);
    if (hasAppsBridge()) return addAppViaBridge({ ...input, repoUrl });
    const slug = repoUrl.split("/").pop() ?? "new-app";
    const app = {
      id: `${slug}-${Date.now()}`,
      name: slug,
      description: `来自 ${repoUrl} 的浏览器降级应用`,
      repoUrl,
      icon: "📦",
    };
    setBrowserApps((current) => [...current, app]);
    return app;
  }, []);

  const highlightApp = useCallback((appId: string) => {
    setHighlightedId(appId);
    window.setTimeout(() => setHighlightedId(""), 2_000);
  }, []);

  const acknowledgeSidebarStatus = useCallback(() => {
    setResultNotice(null);
  }, []);

  const sidebarStatus: AppsSidebarStatus = records.some((record) =>
    workingStates.includes(record.state)
  )
    ? "loading"
    : resultNotice;

  const apps = useMemo<AppListItem[]>(
    () =>
      hasAppsBridge()
        ? [...records]
            .sort((left, right) => left.addedAt - right.addedAt)
            .map((record) => ({
              kind: "installed" as const,
              record,
              step: steps[record.id] ?? "",
              operation: operations[record.id],
              runtimeState: runtimeStates[record.id],
            }))
        : browserApps.map((app) => ({ ...app, kind: "placeholder" as const })),
    [browserApps, operations, records, runtimeStates, steps]
  );

  const value = useMemo<AppsContextValue>(
    () => ({
      apps,
      records,
      presets,
      probePreset: probePresetApp,
      installPreset: installPresetApp,
      discardPresetProbe: discardPresetAppProbe,
      loading,
      listWarning,
      runtimeWarning,
      agentVisibility,
      highlightedId,
      liveLogs,
      sidebarStatus,
      addApp,
      setAgent: setAppAgent,
      saveAsApp,
      renameApp,
      ensureChatSlot: ensureAppChatSlot,
      retrySkill: retryAppSkill,
      removeApp: async (appId, mode) => {
        const effectiveMode = mode ?? "cascade";
        await removeApp(
          appId,
          effectiveMode,
          crypto.randomUUID()
        );
      },
      retryApp: async (appId) => {
        await retryApp(appId);
      },
      repairApp: async (appId) => {
        await repairApp(appId);
      },
      cancelInstall: async (appId) => {
        await cancelAppInstall(appId);
      },
      revealApp: async (appId) => {
        await revealApp(appId);
      },
      highlightApp,
      acknowledgeSidebarStatus,
    }),
    [
      apps,
      records,
      presets,
      loading,
      listWarning,
      runtimeWarning,
      agentVisibility,
      highlightedId,
      liveLogs,
      sidebarStatus,
      addApp,
      highlightApp,
      acknowledgeSidebarStatus,
    ]
  );

  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export function useApps() {
  const context = useOptionalApps();
  if (!context) throw new Error("useApps 必须在 AppsProvider 内使用");
  return context;
}

export function useOptionalApps() {
  return useContext(AppsContext);
}
