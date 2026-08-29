"use client";

/**
 * [INPUT]: Depends on React, Apps-client readAppGuiInfo/onAppsEvent, app generation revisionKey provided by the caller and apps declared by the AppGuiBinding port
 * [OUTPUT]: Provides useAppGui, generates a generation-fenced gui/status, prepares an error and provides short-lived tokens to AppGuiSurface
 * [POS]: The GUI port of the apps module is adapted to the leaf; token single instance semantics determines that the value point must be the only value point and is invalidated by record revision or main gui events
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppGuiBinding } from "./app-gui-surface";
import {
  onAppsEvent,
  readAppGuiInfo,
  releaseAppGuiSurface,
} from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";

const EMPTY = {
  pages: [] as string[],
  origin: "",
  token: "",
  hostActions: [] as readonly import("../../../shared/apps-ipc").BaseGuiHostActionCapability[],
};

/**
 * 每次取值都会在 main 侧重扫 gui/ 并轮换 token（旧 token 立刻作废）。
 * 因此全应用只在此一处调用：多点取值会互相撤销，让先加载的 iframe 401。
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
  const [fetched, setFetched] = useState({
    appId: "",
    info: EMPTY,
    requestKey: "",
    revisionKey: "",
    error: "",
  });
  const [nonce, setNonce] = useState(0);
  const surfaceId = useMemo(
    () => appSurfaceLeaseId ? crypto.randomUUID() : "",
    [appSurfaceLeaseId]
  );
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
    const requestKey = JSON.stringify([appId, revisionKey, nonce]);
    void readAppGuiInfo(input)
      .then((info) =>
        active && setFetched({
          appId,
          info,
          requestKey,
          revisionKey,
          error: info.error ?? "",
        })
      )
      .catch(
        (cause) =>
          active &&
          setFetched((current) => ({
            appId,
            info:
              current.appId === appId && current.revisionKey === revisionKey
                ? current.info
                : EMPTY,
            requestKey,
            revisionKey,
            error: errorMessage(cause),
          }))
      );
    return () => {
      active = false;
    };
  }, [appId, enabled, input, nonce, revisionKey]);

  useEffect(() => {
    if (!input) return;
    return () => {
      void releaseAppGuiSurface(input);
    };
  }, [input]);

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
    fetched.appId === appId &&
    fetched.revisionKey === revisionKey
      ? fetched
      : null;
  /* 逐字段投影而不是整份 spread：AppGuiInfo 还带着 capability 等 wire 字段，
     spread 会把它们偷渡进 binding，在 renderer 侧长出第二个授权真相源。 */
  const info = current?.info ?? EMPTY;
  return {
    pages: info.pages,
    origin: info.origin,
    token: info.token,
    surfaceLeaseId: input?.appSurfaceLeaseId ?? "",
    hostActions: info.hostActions,
    loading: enabled && current?.requestKey !== requestKey,
    error: current?.error ?? "",
    refresh,
  };
}
