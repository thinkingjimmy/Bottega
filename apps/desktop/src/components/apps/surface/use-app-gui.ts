"use client";

/**
 * [INPUT]: Depends on React, Apps-client readAppGuiInfo/ready/release/onAppsEvent, app generation revisionKey provided by the caller and apps declared by the AppGuiBinding port
 * [OUTPUT]: Provides useAppGui with per-refresh runtime surfaces, staged cutover readiness, generation-fenced gui/status, delayed old-surface release, actionable errors, short-lived tokens, and one binding identity per underlying state
 * [POS]: Apps GUI acquisition adapter; one renderer value point owns old and candidate runtime surfaces until double-buffer promotion retires the old lease
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppGuiBinding } from "./app-gui-surface";
import {
  onAppsEvent,
  readAppGuiInfo,
  readyAppGuiSurface,
  releaseAppGuiSurface,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import type { AppGuiInfo, AppGuiInfoInput } from "../../../../shared/apps-ipc";

const EMPTY: AppGuiInfo = {
  pages: [] as string[],
  origin: "",
  token: "",
  generationKey: "",
  bootstrapProtocol: "load-v0" as const,
  baseCapabilities: [] as readonly import("../../../../shared/apps-ipc").BaseGuiCapability[],
  hostActions: [] as readonly import("../../../../shared/apps-ipc").BaseGuiHostActionCapability[],
};

/**
 * 每次取值都会在 main 侧重扫 gui/ 并取得独立 runtime Surface/token。
 * 因此全应用只在此一处调用；旧 Surface 由此处保有到候选帧晋升，再统一释放，
 * 多点取值会制造无法形成同一 double-buffer cohort 的孤儿 lease。
 */
export function useAppGui({
  appId,
  enabled,
  revisionKey,
  appSurfaceLeaseId,
}: Readonly<{
  appId: string;
  enabled: boolean;
  revisionKey: string;
  appSurfaceLeaseId?: string | null;
}>): AppGuiBinding {
  const [fetched, setFetched] = useState<{
    appId: string;
    info: AppGuiInfo;
    requestKey: string;
    revisionKey: string;
    error: string;
    surface: AppGuiInfoInput | null;
  }>({
    appId: "",
    info: EMPTY,
    requestKey: "",
    revisionKey: "",
    error: "",
    surface: null,
  });
  const [nonce, setNonce] = useState(0);
  const ownedSurfaces = useRef(new Map<string, AppGuiInfoInput>());
  const surfaceId = useMemo(() => {
    /* Both values are identity fences: a new revision/refresh gets a distinct
       runtime surface while the previous frame remains owned until promotion. */
    void nonce;
    void revisionKey;
    return appSurfaceLeaseId ? crypto.randomUUID() : "";
  }, [appSurfaceLeaseId, nonce, revisionKey]);
  const releaseOwned = useCallback((surface: AppGuiInfoInput | null) => {
    if (!surface) return;
    ownedSurfaces.current.delete(surface.surfaceId);
    void releaseAppGuiSurface(surface);
  }, []);
  const input = useMemo(
    () => appSurfaceLeaseId && surfaceId
      ? { appId, surfaceId, appSurfaceLeaseId }
      : null,
    [appId, appSurfaceLeaseId, surfaceId]
  );

  // setState 只出现在异步回调里：effect 体内同步置态会触发级联渲染。
  // 「未启用」与「刷新期间保留旧页面」都由下面的派生表达，不靠再存一份状态。
  useEffect(() => {
    if (!enabled || !input) return;
    let active = true;
    ownedSurfaces.current.set(input.surfaceId, input);
    const requestKey = JSON.stringify([appId, revisionKey, nonce]);
    void readAppGuiInfo(input)
      .then((info) => {
        const runtimeSurface = {
          ...input,
          appSurfaceLeaseId:
            info.appSurfaceLeaseId ?? input.appSurfaceLeaseId,
        };
        ownedSurfaces.current.set(input.surfaceId, runtimeSurface);
        if (!active) {
          releaseOwned(runtimeSurface);
          return;
        }
        setFetched({
          appId,
          info,
          requestKey,
          revisionKey,
          error: info.error ?? "",
          surface: runtimeSurface,
        });
      })
      .catch((cause) => {
        releaseOwned(input);
        if (active) {
          setFetched((current) => ({
            appId,
            info:
              current.appId === appId
                ? current.info
                : EMPTY,
            requestKey,
            revisionKey,
            error: errorMessage(cause),
            surface: current.appId === appId ? current.surface : null,
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [appId, enabled, input, nonce, releaseOwned, revisionKey]);

  useEffect(() => {
    const owned = ownedSurfaces.current;
    return () => {
      for (const surface of owned.values()) {
        void releaseAppGuiSurface(surface);
      }
      owned.clear();
    };
  }, [appSurfaceLeaseId]);

  useEffect(() => {
    if (!enabled || !input) return;
    return onAppsEvent((event) => {
      if (event.type === "gui" && event.appId === appId) {
        setNonce((current) => current + 1);
      }
    });
  }, [appId, enabled, input]);

  const refresh = useCallback(() => setNonce((current) => current + 1), []);
  const requestKey = JSON.stringify([appId, revisionKey, nonce]);
  const current =
    enabled && input &&
    fetched.appId === appId
      ? fetched
      : null;
  /* 逐字段投影而不是整份 spread：AppGuiInfo 还带着 capability 等 wire 字段，
     spread 会把它们偷渡进 binding，在 renderer 侧长出第二个授权真相源。 */
  const info = current?.info ?? EMPTY;
  const surface = current?.surface ?? null;
  const cutoverId = info.cutoverId;
  const activate = useCallback(() => {
    const activeId = surface?.surfaceId;
    if (!activeId) return;
    for (const [surfaceId, owned] of [...ownedSurfaces.current]) {
      if (surfaceId !== activeId) releaseOwned(owned);
    }
  }, [releaseOwned, surface]);
  const release = useCallback(() => releaseOwned(surface), [releaseOwned, surface]);
  const ready = useMemo(
    () => cutoverId && surface
      ? (readyNonce: string) => readyAppGuiSurface({ ...surface, cutoverId, readyNonce })
      : undefined,
    [cutoverId, surface]
  );
  const loading = enabled && current?.requestKey !== requestKey;
  const error = current?.error ?? "";
  /* binding 每次渲染换一个新对象，消费者那边就得为一个没变的事实重算
     identity、重建帧、重挂 effect。同一份状态必须给出同一个引用。 */
  return useMemo<AppGuiBinding>(
    () => ({
      pages: info.pages,
      origin: info.origin,
      token: info.token,
      generationKey: info.generationKey ?? "",
      bootstrapProtocol: info.bootstrapProtocol ?? "load-v0",
      surfaceId: surface?.surfaceId ?? "",
      surfaceLeaseId: surface?.appSurfaceLeaseId ?? "",
      cutoverId,
      hostActions: info.hostActions,
      loading,
      error,
      refresh,
      activate,
      ready,
      release,
    }),
    [activate, cutoverId, error, info, loading, ready, refresh, release, surface]
  );
}
