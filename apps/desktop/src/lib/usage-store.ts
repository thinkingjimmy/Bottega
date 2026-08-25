/**
 * [INPUT]: Depends on usage-view-state Access restrictions and target paving, usage-client Summary/scanning/price subscriptions and errors
 * [OUTPUT]: Provides usageStore: module-level snapshot, mount-token activate, per-target seq, powerbrush and revision floor Active closure
 * [POS]: Usage renderer is the sole owner; View subscription-only, price push and no push high revision Summary
 */

import type { UsageQueryTarget } from "../../shared/usage-ipc";
import { errorMessage } from "@/lib/errors";
import {
  getUsageSummary,
  subscribePricingUpdated,
  subscribeScanProgress,
} from "@/lib/usage-client";
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
} from "@/lib/usage-view-state";

export type UsageStoreSnapshot = {
  target: UsageQueryTarget;
  view: UsageViewState;
  progress: UsageProgressState;
  error: string;
};

const listeners = new Set<() => void>();
const activatedMounts = new WeakSet<object>();
const seqByTarget = usageTargetRecord(() => 0);
const convergedFloor = usageTargetRecord(() => -1);

let snapshot: UsageStoreSnapshot = {
  target: "all",
  view: createUsageViewState(),
  progress: {},
  error: "",
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
    (cause) => {
      if (requestGeneration !== generation) return;
      if (mode === "resolved") {
        commit({ type: "rejected", generation: requestGeneration });
      }
      publish({ ...snapshot, error: errorMessage(cause, "用量读取失败") });
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
      error: "",
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

  revalidate,
};
