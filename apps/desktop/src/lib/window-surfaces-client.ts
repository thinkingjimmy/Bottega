/**
 * [INPUT]: Depends on the preload WindowSurfacesBridgeApi, shared surface/capsule DTOs, browser history/sessionStorage, and React external-store hooks
 * [OUTPUT]: Provides windowContext, installWindowSurfaceRuntime, show/open/reclaim intents, transactional capsule export/commit/restore, checkpoints, and useSurfaceResidence
 * [POS]: Renderer client for main-owned surface residency; it caches projections only and never decides ownership
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  assertSurfaceKey,
  type ProductWindowContext,
  type SurfaceCapsuleV1,
  type SurfaceKey,
  type SurfaceResidence,
  type WindowSurfacesBridgeApi,
} from "../../shared/window-surfaces-ipc";
import {
  commitComposerCapsuleExport,
  exportComposerCapsule,
  importComposerCapsule,
  restoreComposerCapsuleExport,
} from "./chat-composer-store";

declare global {
  interface Window {
    windowSurfaces?: WindowSurfacesBridgeApi;
  }
}

const fallbackContext: ProductWindowContext = {
  windowId: "main",
  role: "main",
  appId: null,
};
const residences = new Map<SurfaceKey, SurfaceResidence>();
const listeners = new Map<SurfaceKey, Set<() => void>>();
let runtimeInstalled = false;

export const windowContext = () =>
  window.windowSurfaces?.context ?? fallbackContext;

export function installWindowSurfaceRuntime() {
  if (runtimeInstalled || !window.windowSurfaces) return;
  runtimeInstalled = true;
  window.windowSurfaces.onCommand((command) => void handleCommand(command));
}

type SurfaceCommand = Parameters<WindowSurfacesBridgeApi["onCommand"]>[0] extends (
  value: infer T
) => void
  ? T
  : never;

/* 任何 renderer 侧异常都必须以 failed 回执收尾：静默的 unhandled rejection
   会让 main 苦等 4 秒超时，在退出编排里退化成 crash 语义（优雅退出丢草稿）。 */
async function handleCommand(command: SurfaceCommand) {
  try {
    await runCommand(command);
  } catch (cause) {
    if ("transactionId" in command) {
      window.windowSurfaces?.reply({
        transactionId: command.transactionId,
        outcome: "failed",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

async function runCommand(command: SurfaceCommand) {
    if (command.type === "navigate") {
      navigate(command.route);
      return;
    }
    if (command.type === "residence-changed") {
      commitResidence(command.residence);
      if (command.draftLost) {
        window.dispatchEvent(
          new CustomEvent("bottega:surface-draft-lost", {
            detail: command.residence.surface,
          })
        );
      }
      return;
    }
    if (command.type === "export") {
      const stored = readCapsule(command.surface);
      const capsule: SurfaceCapsuleV1 = stored.route.useChatId
        ? {
            ...stored,
            composer: await exportComposerCapsule(
              stored.route.useChatId,
              command.transactionId
            ),
          }
        : stored;
      writeCapsule(capsule);
      window.windowSurfaces?.reply({
        transactionId: command.transactionId,
        outcome: "exported",
        capsule,
      });
      return;
    }
    const capsule = command.capsule;
    if (command.type === "commit") {
      if (capsule.composer) {
        commitComposerCapsuleExport(command.transactionId, capsule.composer);
      }
      window.windowSurfaces?.reply({
        transactionId: command.transactionId,
        outcome: "committed",
      });
      return;
    }
    if (capsule.composer) {
      if (command.type === "restore") {
        restoreComposerCapsuleExport(command.transactionId, capsule.composer);
      } else {
        importComposerCapsule(capsule.composer);
      }
    }
    writeCapsule(capsule);
    navigate(capsule.route.pathname);
    window.dispatchEvent(
      new CustomEvent("bottega:surface-hydrated", { detail: capsule })
    );
    window.windowSurfaces?.reply({
      transactionId: command.transactionId,
      outcome: command.type === "hydrate" ? "hydrated" : "restored",
    });
}

export async function showSurface(surface: SurfaceKey, route: string) {
  return window.windowSurfaces?.showSurface({ surface, route });
}

export async function openSurfaceInWindow(
  surface: SurfaceKey,
  appId: string,
  route: string,
  expectedRevision?: number,
  useChat?: Readonly<{ chatId: string; incarnationId: string }>
) {
  if (!window.windowSurfaces) return undefined;
  return window.windowSurfaces.openInWindow({
    surface,
    appId,
    route,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(useChat ? { useChat } : {}),
  });
}

export async function reclaimSurface(
  surface: SurfaceKey,
  route: string,
  expectedRevision?: number
) {
  if (!window.windowSurfaces) return undefined;
  return window.windowSurfaces.reclaim({
    surface,
    route,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });
}

export async function syncUseChatResidence(
  appId: string,
  previous?: Readonly<{ chatId: string; incarnationId: string }>,
  next?: Readonly<{ chatId: string; incarnationId: string }>
) {
  return window.windowSurfaces?.syncUseChat({
    appId,
    ...(previous ? { previous } : {}),
    ...(next ? { next } : {}),
  });
}

export function checkpointSurface(
  surface: SurfaceKey,
  route: SurfaceCapsuleV1["route"]
) {
  writeCapsule({ version: 1, surface, route });
}

export function readSurfaceCheckpoint(surface: SurfaceKey) {
  return readCapsule(surface);
}

export function useSurfaceResidence(surface: SurfaceKey) {
  const value = useSyncExternalStore(
    (listener) => subscribe(surface, listener),
    () => residences.get(surface),
    () => undefined
  );
  useEffect(() => {
    if (value || !window.windowSurfaces) return;
    let alive = true;
    void window.windowSurfaces.residence(surface).then((residence) => {
      if (alive) commitResidence(residence);
    });
    return () => {
      alive = false;
    };
  }, [surface, value]);
  return value;
}

export function isCurrentResidence(residence: SurfaceResidence | undefined) {
  if (!residence) return !window.windowSurfaces;
  const context = windowContext();
  return residence.windowId === null
    ? context.role === "main"
    : residence.windowId === context.windowId;
}

function subscribe(surface: SurfaceKey, listener: () => void) {
  const bucket = listeners.get(surface) ?? new Set();
  bucket.add(listener);
  listeners.set(surface, bucket);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) listeners.delete(surface);
  };
}

function commitResidence(residence: SurfaceResidence) {
  const surface = assertSurfaceKey(residence.surface);
  residences.set(surface, { ...residence, surface });
  for (const listener of listeners.get(surface) ?? []) listener();
}

function capsuleKey(surface: SurfaceKey) {
  return `bottega:surface-capsule:v1:${surface}`;
}

function writeCapsule(capsule: SurfaceCapsuleV1) {
  try {
    window.sessionStorage.setItem(capsuleKey(capsule.surface), JSON.stringify(capsule));
  } catch {
    /* A renderer without session storage still returns a route-only capsule. */
  }
}

function readCapsule(surface: SurfaceKey): SurfaceCapsuleV1 {
  try {
    const raw = window.sessionStorage.getItem(capsuleKey(surface));
    if (raw) {
      const parsed = JSON.parse(raw) as SurfaceCapsuleV1;
      if (parsed.version === 1 && parsed.surface === surface) return parsed;
    }
  } catch {
    /* Corrupt local checkpoint falls back to the live route. */
  }
  return {
    version: 1,
    surface,
    route: { pathname: currentRoute() },
  };
}

function currentRoute() {
  const value = window.location.hash.replace(/^#/, "");
  return value.startsWith("/") ? value : "/";
}

function navigate(route: string) {
  if (!route.startsWith("/")) return;
  const next = `#${route}`;
  if (window.location.hash !== next) window.location.hash = route;
}
