/**
 * [INPUT]: The renderer's account projection and the injected remote bridge.
 * [OUTPUT]: Provides cloudSourcesAllowed and cloudRemoteAllowed, the two account conditions every host gates account-owned code on.
 * [POS]: Leaf predicate of lib/cloud/chat; deliberately free of transport, crypto and source construction so a first-paint host can ask without loading any of them.
 */
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { requiresSyncSetup } from "../../../../shared/cloud/sync";
/** The account facts that make cloud-backed sources possible at all.
 *  main asks for one more thing before it will read anything (`cloud/chat/reader.ts`): a binding that already
 *  belongs to this account. `requiresSyncSetup` is that fact's shared sentence — a pre-consent scan has an
 *  account but no binding yet, and every catalog read made in that window used to come back as a stack. */
export const cloudSourcesAllowed = (account: CloudAccountState) =>
  Boolean(account.profile?.userId) && ["ready", "temporarily-offline"].includes(account.status) &&
  !requiresSyncSetup(account.sync) && account.sync.status !== "closing";
/** The account facts that make remote execution possible: the exact condition under which those sources carry a remote port.
 *  Hosts that lazily load account-owned remote code gate on this sentence, never on the injected bridge — the bridge is
 *  handed to every main window, signed in or not. */
export const cloudRemoteAllowed = (account: CloudAccountState) =>
  cloudSourcesAllowed(account) && account.status === "ready" && account.encryption.status === "unlocked" && Boolean(window.cloudRemote);
