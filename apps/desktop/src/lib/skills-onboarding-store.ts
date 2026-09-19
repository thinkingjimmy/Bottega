/**
 * [INPUT]: Depends on unified-skills-client's Library snapshot, discovery candidates and change subscription, and on errors' errorMessage
 * [OUTPUT]: Provides skillsOnboardingStore with subscribe/getSnapshot/ensureLoaded/invalidate and a test reset
 * [POS]: Renderer owner of the one question the Chat onboarding card asks ("is the personal Library empty, and is there anything to import"); the answer belongs to the Skills domain, not to a route visit, so it outlives every ChatRoute mount
 */

import { errorMessage } from "@ai-chat/ui/lib/errors";
import {
  listUnifiedSkillCandidates,
  listUnifiedSkills,
  onUnifiedSkillsChanged,
} from "@/lib/unified-skills-client";

export type SkillsOnboardingSnapshot = {
  /** False until the first read settles; the card shows nothing before then. */
  ready: boolean;
  personalLibraryEmpty: boolean;
  importableCount: number;
  error: string;
};

const EMPTY: SkillsOnboardingSnapshot = {
  ready: false,
  personalLibraryEmpty: false,
  importableCount: 0,
  error: "",
};

const listeners = new Set<() => void>();
let snapshot: SkillsOnboardingSnapshot = EMPTY;
let loaded = false;
let loading = false;
let epoch = 0;
let unsubscribeChanges: (() => void) | null = null;

function publish(next: SkillsOnboardingSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

/* Main broadcasts the full Library snapshot on every Skills change, so the
   subscription — not a per-mount re-read — is what keeps this fresh. It opens
   with the first consumer; module load must not touch the bridge, which App
   windows do not have. */
function start() {
  if (unsubscribeChanges) return;
  unsubscribeChanges = onUnifiedSkillsChanged((pushed) => {
    publish({ ...snapshot, personalLibraryEmpty: pushed.personalLibraryEmpty });
    // The candidate count is not part of the broadcast; only it needs asking.
    load(true);
  });
}

function load(force: boolean) {
  if (!force && (loaded || loading)) return;
  const current = ++epoch;
  loading = true;
  void Promise.all([
    listUnifiedSkills(),
    listUnifiedSkillCandidates("all", false),
  ])
    .then(([library, preview]) => {
      if (current !== epoch) return;
      loaded = true;
      loading = false;
      publish({
        ready: true,
        personalLibraryEmpty: library.personalLibraryEmpty,
        importableCount: preview.candidates.filter(
          (candidate) => candidate.importable && candidate.status !== "current"
        ).length,
        error: "",
      });
    })
    .catch((cause) => {
      if (current !== epoch) return;
      /* Deliberately not marked loaded: a failed read is not an answer, and the
         next consumer to arrive should get to ask again. Success is the only
         state worth caching, and it is the one that repeats. */
      loading = false;
      publish({ ...snapshot, ready: true, error: errorMessage(cause) });
    });
}

export const skillsOnboardingStore = {
  subscribe: (listener: () => void) => {
    start();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
  ensureLoaded: () => {
    start();
    load(false);
  },
  /** Re-read after an action this renderer knows changed the answer. */
  invalidate: () => load(true),
  resetForTests() {
    unsubscribeChanges?.();
    unsubscribeChanges = null;
    loaded = false;
    loading = false;
    epoch += 1;
    snapshot = EMPTY;
  },
};
