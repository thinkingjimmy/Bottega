/**
 * [INPUT]: Depends on the desktop account facade's computer subscription, the shared presence deadline and installation lookup, this computer's machine key from the account snapshot, and the per-profile preference store.
 * [OUTPUT]: Provides useComputerScope — the account's computers with this computer first, the one being viewed, the Projects pinned into this computer's tab, and whether an installation or Project belongs here — plus switchableComputers for the strip.
 * [POS]: The sidebar scope for lib/cloud/computers; the viewed computer and the pin set are per-profile view preferences that confer no execution or account authority.
 */
import { useMemo, useSyncExternalStore } from "react";
import { computerOf, computerOnline, type CloudComputer } from "@ai-chat/cloud-protocol";
import { useAccountComputers } from "@ai-chat/chat-ui/platform-hooks";
import { useCloudAccount } from "@/lib/cloud/client";
import { useDesktopAccountFacade } from "@/lib/cloud/chat/platform/account";
import { computerPreferences, type PinnedRemoteProject } from "./preferences";
export type ComputerScope = {
  /** Ordered for the strip: this computer first, then the account's own order. Empty while the sidebar is local. */
  computers: readonly CloudComputer[];
  /** This computer, once the account knows it; null keeps the sidebar exactly local. */
  self: CloudComputer | null;
  /** The computer whose Projects and Chats the groups show, or null while the sidebar is local. */
  viewed: CloudComputer | null;
  /** True while the groups show this computer, which is also where a pinned Project appears. */
  local: boolean;
  now: number;
  select(machineIdHash: string): void;
  /** Adding something that lives here brings the strip back, so its result is in sight. */
  selectLocal(): void;
  /** Whether an installation belongs to the viewed computer; true while the sidebar is local, so nothing is hidden. */
  owns(deviceId: string | null | undefined): boolean;
  /** Another computer's Projects pinned into this computer's tab; empty without an account. */
  pinned: readonly PinnedRemoteProject[];
  /** Whether this Project is on show here because it was pinned — never true in another computer's tab. */
  pinnedHere(projectId: string | null | undefined): boolean;
  pin(entry: PinnedRemoteProject): void;
  /** Keeps a pinned row's fallback label in step with the owner's Project while it is still there to read. */
  describe(entry: PinnedRemoteProject): void;
  unpin(projectId: string): void;
};
const noPins = { pinned: [] as readonly PinnedRemoteProject[], pinnedHere: () => false, pin: () => {}, describe: () => {}, unpin: () => {} };
export function useComputerScope(): ComputerScope {
  const state = useCloudAccount(), facade = useDesktopAccountFacade();
  const { computers, now } = useAccountComputers(facade);
  const machineIdHash = state.machine?.idHash ?? null, userId = state.profile?.userId ?? null;
  useSyncExternalStore(computerPreferences.subscribe, computerPreferences.snapshot, computerPreferences.snapshot);
  const preference = computerPreferences.profile(userId);
  return useMemo(() => {
    /* Without this computer in the account's list there is no first tab to put anyone after, and local content would
       have nowhere to live. The sidebar then stays exactly what it is offline: this computer's, unfiltered — and a
       pin, which is only ever a rearrangement of this computer's tab, has nothing to rearrange. */
    const self = (machineIdHash ? computers?.find(item => item.machineIdHash === machineIdHash) : null) ?? null;
    if (!self || !computers || !userId) return { computers: [], self: null, viewed: null, local: true, now,
      select: () => {}, selectLocal: () => {}, owns: () => true, ...noPins };
    const ordered = [self, ...computers.filter(item => item !== self)];
    const viewed = ordered.find(item => item.machineIdHash === preference.viewed) ?? self;
    const local = viewed === self;
    const select = (value: string) => computerPreferences.select(userId, value);
    return { computers: ordered, self, viewed, local, now, select,
      selectLocal: () => { if (!local) select(self.machineIdHash); },
      owns: deviceId => computerOf(computers, deviceId)?.machineIdHash === viewed.machineIdHash,
      pinned: preference.pinned,
      pinnedHere: projectId => local && Boolean(projectId) && preference.pinned.some(item => item.id === projectId),
      pin: entry => computerPreferences.pin(userId, entry),
      describe: entry => computerPreferences.describe(userId, entry),
      unpin: projectId => computerPreferences.unpin(userId, projectId) };
  }, [computers, preference, machineIdHash, now, userId]);
}
/** The strip's own facts: the component takes presence as the host reads it, deadline included. */
export function switchableComputers(scope: ComputerScope) {
  return scope.computers.map(item => ({ machineIdHash: item.machineIdHash, name: item.name,
    online: computerOnline(item, scope.now), lastSeenAt: item.lastSeenAt }));
}
