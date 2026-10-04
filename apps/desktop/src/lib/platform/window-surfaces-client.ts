/**
 * [INPUT]: Depends on the preload WindowSurfacesBridgeApi, shared surface/capsule DTOs, browser history/sessionStorage, and React external-store hooks
 * [OUTPUT]: Provides windowContext, installWindowSurfaceRuntime (including background-surface Settings/Usage/activity destinations, and a quit's flush-drafts answered flushed only when every held draft is on disk), navigation-generation-fenced show/open/reclaim intents, capsule operations (draft/queue image bytes ride beside the exported capsule), the pre-quit durable draft flush, a refused export restored from this window's own record, checkpoints, nullable useSurfaceResidence, and useHoldsSurface (resident here and not being exported: an exported surface is leaving until commit, restore or an aborted export)
 * Freezes the renderer before awaiting quit persistence and thaws it on resume-drafts.
 * [POS]: apps/desktop/src/lib/platform; Renderer client for main-owned surface residency; it caches projections only and never decides ownership
 */

import { useEffect, useSyncExternalStore } from "react";
import {
  assertSurfaceKey,
  type ProductWindowContext,
  type SurfaceCapsuleV1,
  type SurfaceKey,
  type SurfaceResidence,
  type WindowSurfacesBridgeApi,
} from "../../../shared/ipc/settings/window-surfaces-ipc";
import {
  composerRevision,
  validateComposerCapsuleExport,
  commitComposerCapsuleExport,
  exportComposerCapsule,
  importComposerCapsule,
  restoreComposerCapsuleExport,
} from "../chat/state/composer/chat-composer-store";
import { takeComposerImageTransfers } from "../chat-composer/images";
import { flushDurableDrafts } from "../chat-composer/durable/durable";
import { requestSettingsSection } from "../settings/navigation/settings-navigation";

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
/* What this window exported, per transaction, until main commits, restores or refuses it. */
const exportedCapsules = new Map<string, SurfaceCapsuleV1>();
/* Surfaces this window is exporting, per transaction: from the export until commit, restore or an aborted export they are leaving, so
   the page stops acting as their holder before main publishes where they went (and holds them again if the move is restored). */
const leaving = new Map<string, SurfaceKey>();
function settleLeaving(transactionId: string) {
  const surface = leaving.get(transactionId);
  if (!surface || !leaving.delete(transactionId)) return;
  for (const listener of listeners.get(surface) ?? []) listener();
}

async function handleCommand(command: SurfaceCommand) {
  try {
    await runCommand(command);
  } catch (cause) {
    document.getElementById("root")?.removeAttribute("inert");
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
    if (command.type === "presence-destination") {
      // "general" once navigated to a /settings/general route that never existed; every Settings target is an overlay section.
      if (command.destination === "activity") window.dispatchEvent(new Event("bottega:open-activity"));
      else requestSettingsSection({ section: command.destination, agent: command.agent ?? null });
      return;
    }
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
    if (command.type === "abort-export") {
      settleLeaving(command.transactionId);
      // Main refused the export before claiming anything: restore from what this window itself exported.
      const exported = exportedCapsules.get(command.transactionId);
      exportedCapsules.delete(command.transactionId);
      if (exported?.composer) restoreComposerCapsuleExport(command.transactionId, exported.composer);
      document.getElementById("root")?.removeAttribute("inert");
      window.windowSurfaces?.reply({ transactionId: command.transactionId, outcome: "restored" });
      return;
    }
    if (command.type === "flush-drafts") {
      document.getElementById("root")?.setAttribute("inert", "");
      /* A draft that is not on disk is never reported as flushed: the quit hears it and decides (review 0929 F01). */
      const { saved } = await flushDurableDrafts();
      window.windowSurfaces?.reply(saved ? { transactionId: command.transactionId, outcome: "flushed" }
        : { transactionId: command.transactionId, outcome: "failed", message: "COMPOSER_DRAFTS_UNSAVED" });
      return;
    }
    if (command.type === "resume-drafts") {
      document.getElementById("root")?.removeAttribute("inert");
      return;
    }
    if (command.type === "prepare-hydrate") {
      window.windowSurfaces?.reply({ transactionId: command.transactionId, outcome: "prepared",
        composerRevision: command.capsule.composer ? composerRevision(command.capsule.composer.chatId) : 0 });
      return;
    }
    if (command.type === "validate-export") {
      if (command.capsule.composer) validateComposerCapsuleExport(command.transactionId, command.capsule.composer);
      window.windowSurfaces?.reply({ transactionId: command.transactionId, outcome: "validated" });
      return;
    }
    if (command.type === "export") {
      leaving.set(command.transactionId, command.surface);
      for (const listener of listeners.get(command.surface) ?? []) listener();
      document.getElementById("root")?.setAttribute("inert", "");
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
      exportedCapsules.set(command.transactionId, capsule);
      window.windowSurfaces?.reply({
        transactionId: command.transactionId,
        outcome: "exported",
        capsule,
        images: takeComposerImageTransfers(command.transactionId),
      });
      return;
    }
    const capsule = command.capsule;
    if (command.type === "restore" || command.type === "commit") {
      document.getElementById("root")?.removeAttribute("inert");
      exportedCapsules.delete(command.transactionId);
      settleLeaving(command.transactionId);
    }
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
        importComposerCapsule(capsule.composer, command.transactionId, command.expectedComposerRevision, command.images);
      }
    }
    writeCapsule(capsule);
    if (command.type === "hydrate" && command.mode === "background") {
      window.windowSurfaces?.reply({ transactionId: command.transactionId, outcome: "hydrated", mode: "background" });
      return;
    }
    navigate(capsule.route.pathname);
    window.dispatchEvent(
      new CustomEvent("bottega:surface-hydrated", { detail: capsule })
    );
    window.windowSurfaces?.reply({
      transactionId: command.transactionId,
      outcome: command.type === "hydrate" ? "hydrated" : "restored",
      ...(command.type === "hydrate" ? { mode: command.mode ?? "present" } : {}),
    });
}

export async function beginSurfaceNavigationIntent(intentId: string) {
  const bridge = window.windowSurfaces;
  if (!bridge?.beginNavigationIntent) return;
  await bridge.beginNavigationIntent({ intentId });
}

export async function showSurface(
  surface: SurfaceKey,
  route: string,
  navigationIntentId?: string
) {
  return window.windowSurfaces?.showSurface({
    surface,
    route,
    ...(navigationIntentId ? { navigationIntentId } : {}),
  });
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

export function useSurfaceResidence(surface: SurfaceKey | null) {
  const value = useSyncExternalStore(
    (listener) => (surface ? subscribe(surface, listener) : () => {}),
    () => (surface ? residences.get(surface) : undefined),
    () => undefined
  );
  useEffect(() => {
    if (!surface || value || !window.windowSurfaces) return;
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

/** Whether this window holds the surface now: resident here and not being exported away. */
export function useHoldsSurface(surface: SurfaceKey) {
  const residence = useSurfaceResidence(surface);
  const isLeaving = useSyncExternalStore(
    (listener) => subscribe(surface, listener),
    () => [...leaving.values()].includes(surface),
    () => false
  );
  return isCurrentResidence(residence) && !isLeaving;
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
