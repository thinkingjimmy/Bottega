/**
 * [INPUT]: An exact authenticated parent origin, a fresh frame nonce and one encrypted-command result.
 * [OUTPUT]: One-time worker key handoff and a keyless close channel retained by the parent.
 * [POS]: Dormant server wrapper; replaced by the App document after the worker claims this origin.
 */
import { mountServerTunnel } from "./client";
import workerUrl from "./worker?worker&url";
declare const __ARTIFACT_PARENT_ORIGIN__: string;
const nonce = location.hash.slice(1), controller = new AbortController();
let claimed = false;
if (parent === window || !/^[a-f0-9-]{36}$/.test(nonce)) throw new Error("tunnel-parent-required");
addEventListener("message", event => {
  if (claimed || event.source !== parent || event.origin !== __ARTIFACT_PARENT_ORIGIN__ || event.data?.nonce !== nonce || event.data?.type !== "bottega:tunnel:mount") return;
  claimed = true;
  void mountServerTunnel(event.data.grant, workerUrl, controller.signal, control => {
    parent.postMessage({ type: "bottega:tunnel:mounted", nonce }, __ARTIFACT_PARENT_ORIGIN__, [control]);
  }).catch(cause => { parent.postMessage({ type: "bottega:tunnel:failed", nonce, reason: cause instanceof Error ? cause.message : "tunnel-failed" }, __ARTIFACT_PARENT_ORIGIN__); });
});
parent.postMessage({ type: "bottega:tunnel:ready", nonce }, __ARTIFACT_PARENT_ORIGIN__);
