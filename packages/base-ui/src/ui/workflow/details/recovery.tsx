/**
 * [INPUT]: A blocked run, the owning-computer facts and the admitted remote recovery port.
 * [OUTPUT]: RemoteRecovery: actionable local instructions plus remote enable/retry where supported.
 * [POS]: Remote-only portion of the shared blocked-step notice; never offers Provider sign-in on a phone.
 */
import { useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "../../platform/i18n";
import type { BlockedReasonView, RunHostFacts, WorkflowRunPort, WorkflowRunView } from "../run-port";
import { detailCopy } from "./copy";
import { useKeptState } from "../runs-context";
export function RemoteRecovery({ run, stepId, reason, stepLabel, facts, port }: {
  run: WorkflowRunView; stepId: string; reason: BlockedReasonView | null; stepLabel: string; facts: RunHostFacts; port: WorkflowRunPort;
}) {
  const { i18n } = useAppTranslation(), copy = detailCopy(i18n.language);
  const [busy, setBusy] = useKeptState(`${run.runId}:${stepId}:retry-busy`, false), [failed, setFailed] = useState(false);
  if (!facts.remote || !reason) return null;
  const extractor = reason.kind === "no-valid-report" && reason.extractor;
  const plugin = reason.kind === "plugin-disabled" || extractor === "plugin-disabled";
  const provider = extractor ? "claude" : reason.provider;
  const values = { computer: facts.computer, provider: provider ? facts.providerLabel(provider) : "", step: stepLabel };
  const format = (text: string) => Object.entries(values).reduce((line, [key, value]) => line.replaceAll("{" + key + "}", value), text);
  const guidance = plugin ? copy.plugin : provider && (reason.kind.startsWith("provider-") || Boolean(extractor)) ? copy.provider : copy.config;
  const enable = async () => {
    setBusy(true); setFailed(false);
    try { await port.enableBlockingPlugin!(run.runId, stepId); } catch { setFailed(true); } finally { setBusy(false); }
  };
  return <div className="space-y-2" data-remote-recovery>
    <p>{format(guidance)}</p>
    {facts.offline && <p>{format(copy.offline)}</p>}
    {facts.remoteCompatible === false && <p>{format(copy.upgrade)}</p>}
    {plugin && Boolean(provider) && port.enableBlockingPlugin && <Button size="sm" className="min-h-11" disabled={busy || facts.offline || facts.remoteCompatible === false || run.state !== "blocked"}
      onClick={() => void enable()}>{format(copy.enable)}</Button>}
    {busy && <p role="status">{copy.enabling}</p>}{failed && <p role="alert">{format(copy.enableFailed)}</p>}
  </div>;
}
