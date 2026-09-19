/**
 * [INPUT]: The renderer's account projection and the injected remote bridge.
 * [OUTPUT]: Provides cloudSourcesAllowed and cloudRemoteAllowed, the two account conditions every host gates account-owned code on.
 * [POS]: Leaf predicate of lib/cloud/chat; deliberately free of transport, crypto and source construction so a first-paint host can ask without loading any of them.
 */
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
/** The account facts that make cloud-backed sources possible at all. */
export const cloudSourcesAllowed = (account: CloudAccountState) =>
  Boolean(account.profile?.userId && ["ready", "temporarily-offline"].includes(account.status) && !["not-connected", "closing"].includes(account.sync.status));
/** The account facts that make remote execution possible: the exact condition under which those sources carry a remote port.
 *  Hosts that lazily load account-owned remote code gate on this sentence, never on the injected bridge — the bridge is
 *  handed to every main window, signed in or not. */
export const cloudRemoteAllowed = (account: CloudAccountState) =>
  cloudSourcesAllowed(account) && account.status === "ready" && account.encryption.status === "unlocked" && Boolean(window.cloudRemote);
