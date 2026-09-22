/**
 * [INPUT]: Depends on the renderer's localStorage only.
 * [OUTPUT]: Provides computerPreferences — the per-profile viewed computer and the pinned remote Projects, as one store every consumer subscribes to, plus the PinnedRemoteProject shape.
 * [POS]: Renderer view preferences for lib/cloud/computers; a preference is a view arrangement and confers no execution, account or folder authority, and it never leaves this profile.
 */
/**
 * A pin copies nothing: the row it draws is the owner's Project, read from the mirror like any other. The name and
 * the publishing installation travel with the id for one reason — once the owner deletes the Project the mirror row
 * is gone, and the pinned row still has to say which Project on which computer it was rather than vanish.
 */
export type PinnedRemoteProject = { id: string; name: string; deviceId: string | null };
type Profile = { viewed: string | null; pinned: readonly PinnedRemoteProject[] };
const MAX_PINNED = 50;
const EMPTY: Profile = { viewed: null, pinned: [] };
const viewedKey = (userId: string) => `bottega.sidebar-computer:${encodeURIComponent(userId)}`;
const pinnedKey = (userId: string) => `bottega.sidebar-pinned-projects:${encodeURIComponent(userId)}`;
function readItem(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeItem(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* The choice still applies to this window. */ }
}
function parsePinned(raw: string | null): PinnedRemoteProject[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
      const entry = item as Partial<PinnedRemoteProject> | null;
      return entry && typeof entry.id === "string" && entry.id
        ? [{ id: entry.id, name: typeof entry.name === "string" ? entry.name : "",
          deviceId: typeof entry.deviceId === "string" ? entry.deviceId : null }]
        : [];
    }).slice(0, MAX_PINNED);
  } catch { return []; }
}
const cache = new Map<string, Profile>();
const listeners = new Set<() => void>();
/* The snapshot is an identity, not a value: consumers read the profile they care about, and this only tells them
   that some profile changed. */
let revision: object = {};
function load(userId: string): Profile {
  const cached = cache.get(userId);
  if (cached) return cached;
  const value: Profile = { viewed: readItem(viewedKey(userId)), pinned: parsePinned(readItem(pinnedKey(userId))) };
  cache.set(userId, value);
  return value;
}
function commit(userId: string, next: Profile) {
  cache.set(userId, next);
  revision = {};
  for (const listener of listeners) listener();
}
function persistPinned(userId: string, pinned: readonly PinnedRemoteProject[]) {
  writeItem(pinnedKey(userId), JSON.stringify(pinned));
  commit(userId, { ...load(userId), pinned });
}
export const computerPreferences = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: () => revision,
  profile(userId: string | null): Profile {
    return userId ? load(userId) : EMPTY;
  },
  select(userId: string, machineIdHash: string) {
    writeItem(viewedKey(userId), machineIdHash);
    commit(userId, { ...load(userId), viewed: machineIdHash });
  },
  pin(userId: string, entry: PinnedRemoteProject) {
    const current = load(userId).pinned;
    persistPinned(userId, [...current.filter(item => item.id !== entry.id), entry].slice(-MAX_PINNED));
  },
  /** Re-reading the owner's own name keeps the row honest while the Project is still there to read it from. */
  describe(userId: string, entry: PinnedRemoteProject) {
    const current = load(userId).pinned, existing = current.find(item => item.id === entry.id);
    if (!existing || existing.name === entry.name && existing.deviceId === entry.deviceId) return;
    persistPinned(userId, current.map(item => item.id === entry.id ? entry : item));
  },
  unpin(userId: string, projectId: string) {
    const current = load(userId).pinned;
    if (current.every(item => item.id !== projectId)) return;
    persistPinned(userId, current.filter(item => item.id !== projectId));
  },
  /** A test installs a fresh window per case, and this cache must not outlive the storage it was read from. */
  forget() {
    cache.clear();
    revision = {};
  },
};
