/**
 * [INPUT]: Depends on usage-view-state access restrictions/target paving and usage-client summaries/scanning/price subscriptions
 * [OUTPUT]: Provides usageStore: a module-level snapshot with mount-token activation, the chosen source and Cost/Tokens metric (both survive remounts), per-target sequence tracking, pricing refresh, and a revision floor that discards stale responses; a failed request never raises a page-level error (the panel says so only when a tab has nothing to show)
 * [POS]: apps/desktop/src/lib/usage; Renderer's sole owner of Usage state; views only subscribe, and a summary can never overwrite a higher revision already applied
 */

import type { UsageQueryTarget } from "../../../shared/ipc/settings/usage-ipc";
import {
  getUsageSummary,
  subscribePricingUpdated,
  subscribeScanProgress,
} from "@/lib/usage/usage-client";
import {
  createUsageViewState,
  usageProgressReducer,
  usageViewReducer,
  FIRST_USAGE_GENERATION,
  USAGE_TARGETS,
  usageTargetRecord,
  type UsageProgressState,
  type UsageViewAction,
  type UsageViewState,
} from "@/lib/usage/usage-view-state";

export type UsageMetric = "cost" | "tokens";

export type UsageStoreSnapshot = {
  target: UsageQueryTarget;
  /** Lives here, not in the Today section, which unmounts while a tab loads or has no data. */
  metric: UsageMetric;
  view: UsageViewState;
  progress: UsageProgressState;
};

const listeners = new Set<() => void>();
const activatedMounts = new WeakSet<object>();
const seqByTarget = usageTargetRecord(() => 0);
const convergedFloor = usageTargetRecord(() => -1);

let snapshot: UsageStoreSnapshot = {
  target: "all",
  metric: "cost",
  view: createUsageViewState(),
  progress: {},
};
let generation = FIRST_USAGE_GENERATION;
let loaded = false;
let subscribed = false;

function publish(next: UsageStoreSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function convergeFloor() {
  const floor = snapshot.view.knownPricingRevision;
  const stale = USAGE_TARGETS.filter(
    (target) =>
      snapshot.view.applied[target].revision < floor &&
      convergedFloor[target] < floor
  );
  for (const target of stale) convergedFloor[target] = floor;
  if (stale.length > 0) revalidate(stale);
}

function commit(action: UsageViewAction) {
  const previousFloor = snapshot.view.knownPricingRevision;
  const view = usageViewReducer(snapshot.view, action);
  if (view === snapshot.view) return;
  publish({ ...snapshot, view });
  if (
    action.type !== "pricing-known" &&
    view.knownPricingRevision > previousFloor
  ) {
    convergeFloor();
  }
}

function nextSeq(target: UsageQueryTarget) {
  seqByTarget[target] += 1;
  return seqByTarget[target];
}

function request(
  target: UsageQueryTarget,
  mode: "resolved" | "revalidated",
  forceRefresh: boolean,
  requestGeneration = generation
) {
  const seq = nextSeq(target);
  void getUsageSummary(target, { forceRefresh }).then(
    (summary) =>
      commit({
        type: mode,
        generation: requestGeneration,
        target,
        seq,
        summary,
      }),
    /* Numbers already on screen stay; a tab with nothing to show says it could not read (UsageContent). The raw IPC error
       is a diagnostic, never page copy. */
    () => {
      if (requestGeneration !== generation || mode !== "resolved") return;
      commit({ type: "rejected", generation: requestGeneration });
    }
  );
}

function fetchAll(forceRefresh: boolean) {
  const requestGeneration = generation;
  for (const target of USAGE_TARGETS) {
    request(target, "resolved", forceRefresh, requestGeneration);
  }
}

function revalidate(targets: readonly UsageQueryTarget[]) {
  const requestGeneration = generation;
  for (const target of targets) {
    request(target, "revalidated", false, requestGeneration);
  }
}

function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;
  subscribeScanProgress((next) => {
    const progress = usageProgressReducer(snapshot.progress, next);
    if (progress !== snapshot.progress) publish({ ...snapshot, progress });
  });
  subscribePricingUpdated(({ pricingRevision }) => {
    if (pricingRevision <= snapshot.view.knownPricingRevision) return;
    commit({ type: "pricing-known", pricingRevision });
    for (const target of USAGE_TARGETS) {
      convergedFloor[target] = Math.max(
        convergedFloor[target],
        pricingRevision
      );
    }
    revalidate(USAGE_TARGETS);
  });
}

export const usageStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,

  activate: (mountToken: object) => {
    if (activatedMounts.has(mountToken)) return;
    activatedMounts.add(mountToken);
    subscribeOnce();
    if (!loaded) {
      loaded = true;
      fetchAll(false);
      return;
    }
    revalidate(USAGE_TARGETS);
  },

  refresh: () => {
    generation += 1;
    publish({
      ...snapshot,
      view: usageViewReducer(snapshot.view, {
        type: "load-started",
        generation,
      }),
    });
    fetchAll(true);
  },

  setTarget: (target: UsageQueryTarget) => {
    if (target === snapshot.target) return;
    publish({ ...snapshot, target });
    if (loaded) revalidate([target]);
  },

  setMetric: (metric: UsageMetric) => {
    if (metric !== snapshot.metric) publish({ ...snapshot, metric });
  },

  revalidate,
};
