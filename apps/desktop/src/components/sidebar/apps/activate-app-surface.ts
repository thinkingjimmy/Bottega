/**
 * [INPUT]: Depends on an App record, router navigation, and a generation-fenced main-owned showSurface intent
 * [OUTPUT]: Provides activateAppSurface with five explicit outcomes and optional last-intent-wins generation
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
