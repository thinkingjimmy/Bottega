/**
 * [INPUT]: Depends on an App record, router navigation, a generation-fenced main-owned showSurface intent, and the Sidebar App origin store
 * [OUTPUT]: Provides activateAppSurface with five explicit outcomes and optional last-intent-wins generation, plus activateSidebarApp — the epoch-fenced begin/await/activate/commit flow both Sidebar alias lists run
 * [POS]: Shared activation boundary for global and Project-scoped Sidebar App aliases
 */

import type { AppRecord } from "../../../../shared/apps-ipc";
import {
  appStudioSurface,
  canonicalAppSurfaceRoute,
  type SurfaceIntentResult,
} from "../../../../shared/window-surfaces-ipc";
import { showSurface } from "@/lib/window-surfaces-client";
import { isWorkingState } from "../../apps/app-state";
import { sidebarAppOriginStore } from "../active/app-origin";

export type AppSurfaceActivation =
  | Readonly<{ outcome: "main-shown" }>
  | Readonly<{ outcome: "window-focused" }>
  | Readonly<{ outcome: "progress" }>
  | Readonly<{ outcome: "fallback-main" }>
  | Readonly<{ outcome: "failed"; cause: unknown }>;

type ActivateAppSurfacePorts = Readonly<{
  navigate(route: string): void;
  show?: (
    surface: ReturnType<typeof appStudioSurface>,
    route: string,
    navigationIntentId?: string
  ) => Promise<SurfaceIntentResult | undefined>;
  navigationIntentId?: string;
  onError?: (cause: unknown) => void;
}>;

export async function activateAppSurface(
  record: AppRecord,
  ports: ActivateAppSurfacePorts
): Promise<AppSurfaceActivation> {
  if (isWorkingState(record.state)) {
    ports.navigate(`/apps?progress=${record.id}`);
    return { outcome: "progress" };
  }
  const route = canonicalAppSurfaceRoute(record.id);
  try {
    const result = await (ports.show ?? showSurface)(
      appStudioSurface(record.id),
      route,
      ports.navigationIntentId
    );
    if (!result) {
      ports.navigate(route);
      return { outcome: "fallback-main" };
    }
    return {
      outcome:
        result.residence.windowId === null ? "main-shown" : "window-focused",
    };
  } catch (cause) {
    ports.onError?.(cause);
    return { outcome: "failed", cause };
  }
}

/* ============================================================
 * The Sidebar side of activation: open a generation, wait for main to accept
 * the intent, bail if a newer click superseded it, then activate. A Project
 * alias records its origin once the surface is shown in the main window; a
 * global pin has no origin to record, so both paths just release the epoch.
 * ============================================================ */
export async function activateSidebarApp(
  record: AppRecord,
  ports: Readonly<{
    navigate(route: string): void;
    onError(cause: unknown): void;
    origin?: Readonly<{ projectId: string }>;
  }>
) {
  const activation = sidebarAppOriginStore.beginActivation(record.id);
  try {
    await activation.ready;
  } catch (cause) {
    sidebarAppOriginStore.finishNavigation(activation.epoch);
    ports.onError(cause);
    return;
  }
  if (!sidebarAppOriginStore.isCurrent(activation.epoch)) return;
  const result = await activateAppSurface(record, {
    navigate: ports.navigate,
    navigationIntentId: activation.intentId,
    onError: ports.onError,
  });
  const shownInMain =
    result.outcome === "main-shown" || result.outcome === "fallback-main";
  if (ports.origin && shownInMain) {
    sidebarAppOriginStore.commitActivation(activation.epoch, {
      appId: record.id,
      projectId: ports.origin.projectId,
    });
  } else {
    sidebarAppOriginStore.finishNavigation(activation.epoch);
  }
}
