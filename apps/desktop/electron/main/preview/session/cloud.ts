/**
 * [INPUT]: The same account-scope admission, encrypted space and transport used by resource commands.
 * [OUTPUT]: attachPreviewCloud, with original-scope leases and immediate lock/account cleanup.
 * [POS]: Thin control-plane adapter; no preview hostname, code or application traffic is uploaded here.
 */
import { accountScopeAdmission, type AdmissionPorts } from "../../cloud/sync/account-config/admission";
import type { CloudAccountService } from "../../cloud/runtime/service";
import type { AccountTransport } from "../../cloud/runtime/transport/transport";
import { previewFeature } from "./runtime";
export function attachPreviewCloud(ports: AdmissionPorts & { account: AdmissionPorts["account"] & Pick<CloudAccountService, "subscribeIdentity" | "subscribeConnection">;
  transport: Pick<AccountTransport, "mutate">; own(activity: { close(): Promise<void> }): () => void }) {
  const feature = previewFeature(); if (!feature) return { close: async () => {} };
  let key = "", release = () => {}, stopped = false;
  const wake = () => {
    if (stopped) return;
    const admission = accountScopeAdmission(ports);
    if (admission.kind === "offline") return;
    if (admission.kind !== "admitted") {
      key = ""; release(); release = () => {}; feature.sessions.configure(null);
      void feature.sessions.revokeAll().catch(() => undefined); return;
    }
    if (key === admission.key) return;
    release(); void feature.sessions.revokeAll().catch(() => undefined); key = admission.key;
    const assert = () => {
      const current = accountScopeAdmission(ports);
      if (current.kind !== "admitted" || current.key !== admission.key || stopped) throw new Error("preview-account-required");
    };
    feature.sessions.configure({
      async register(input) { assert(); const lease = await ports.transport.mutate("preview/sessions:register", { ...admission.header, ...input }); assert(); return lease; },
      async renew(sessionId) { assert(); const lease = await ports.transport.mutate("preview/sessions:renew", { ...admission.header, sessionId }); assert(); return lease; },
      async release(sessionId) { await ports.transport.mutate("preview/sessions:release", { ...admission.header, sessionId }); },
    });
    release = ports.own({ close: async () => { key = ""; feature.sessions.configure(null); await feature.sessions.revokeAll(); } });
  };
  const unsubscribers = [ports.account.subscribeIdentity(wake), ports.account.subscribeConnection(wake)];
  const timer = setInterval(wake, 1000); timer.unref(); wake();
  return { async close() { stopped = true; clearInterval(timer); for (const unsubscribe of unsubscribers) unsubscribe();
    release(); feature.sessions.configure(null); await feature.sessions.revokeAll(); } };
}
