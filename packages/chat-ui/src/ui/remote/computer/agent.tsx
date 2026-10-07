/**
 * [INPUT]: Target Agent capabilities and quota, shared picker presentation/identity/update copy and remote recovery instructions.
 * [OUTPUT]: RemoteAgentSelector lists installed Agents in published order with native login/quota/update precedence and remote execution guards.
 * [POS]: The computer surface's Agent chip, shared by creation and conversation; it chooses an Agent on one computer and never chooses a computer.
 */
import { useEffect, useId, useState } from "react";
import type { RemoteAgentCapability, RemoteTarget } from "@ai-chat/cloud-protocol/remote/model";
import { emptyAgentLimits } from "@ai-chat/cloud-protocol/remote/quota-view";
import { backendName, type RemoteCopy } from "../../../i18n/messages/remote";
import { QuotaSummaryText } from "../../composer/agent/quota/summary";
import { AgentPicker, type AgentPickerRow } from "../../composer/agent/picker";
import { createQuotaFormat } from "../../composer/agent/quota/format";
import { quotaTranslate } from "../../composer/agent/quota/copy";
import { backendLabel } from "@ai-chat/ui/components/identity/agent";
import { projectAgentPickerPresentation } from "../../composer/agent/presentation";
import { agentPickerCopy } from "../../composer/agent/copy";
const presentationFor = (option: RemoteAgentCapability) => projectAgentPickerPresentation({
  state: option.available ? "ready" : option.reason === "agent-outdated" ? "unsupported" : "unavailable",
  signedOut: option.reason === "auth-required", limits: option.quota,
});
export function RemoteAgentSelector({ target, value, copy, disabled, onSelect, locale = "en", quotaEnabled = true }: {
  quotaEnabled?: boolean; locale?: string; target: RemoteTarget | undefined; value: string; copy: RemoteCopy; disabled?: boolean;
  onSelect(backend: RemoteTarget["agents"][number]["backend"]): void;
}) {
  const agents = target?.agents ?? [], selected = agents.find(option => option.backend === value);
  const options = agents.filter(option => option.reason !== "agent-missing");
  const [open, setOpen] = useState(false), [now, setNow] = useState(Date.now), descriptionId = useId();
  useEffect(() => { if (!open) return; const timer = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, [open]);
  const reasonText = (reason: string | null | undefined, backend: string) => ({ "agent-missing": copy.agentMissing, "agent-outdated": copy.agentOutdated, "auth-required": copy.authRequired }[reason ?? ""] ?? copy.unavailableAgent).replace("{agent}", backendName(backend));
  const selectedState = selected && presentationFor(selected).state;
  const label = selectedState === "sign-in" ? reasonText("auth-required", value) : selected && !selected.available ? reasonText(selected.reason, selected.backend)
    : !options.length ? copy.noAgentAvailable : value ? backendLabel(value) : copy.chooseAgent;
  const t = quotaTranslate(locale), pickerCopy = agentPickerCopy(locale), { quotaDescription } = createQuotaFormat(() => locale);
  const rows: AgentPickerRow[] = options.map(option => {
    const quota = option.quota ?? emptyAgentLimits(option.backend), current = option.backend === value;
    const presentation = presentationFor(option);
    const canSelect = option.available && presentation.state !== "sign-in" && !disabled;
    const stateText = presentation.state === "sign-in" ? reasonText("auth-required", option.backend)
      : presentation.update === "required" ? pickerCopy.updateForUsage : reasonText(option.reason, option.backend);
    const updateText = presentation.update === "available" ? pickerCopy.updateAvailable : undefined;
    const showQuota = quotaEnabled && presentation.showQuota;
    return { id: option.backend, name: backendLabel(option.backend), current, choosable: canSelect || current,
      inert: !current && !canSelect, dim: !current && !canSelect,
      tone: presentation.state === "ready" ? "quiet" : "attention", label: backendLabel(option.backend),
      description: [showQuota ? quotaDescription(quota, now, t) : option.available && presentation.state === "ready" ? copy.online : stateText, updateText,
        !option.available ? reasonText(option.reason, option.backend) : undefined].filter(Boolean).join("\n"),
      line: showQuota ? <div className="flex flex-wrap items-center gap-x-1"><div className="text-muted-foreground"><QuotaSummaryText agent={quota} now={now} locale={locale} /></div>{updateText && <span className="text-amber-700 dark:text-amber-400">{`· ${updateText}`}</span>}</div>
        : option.available && presentation.state === "ready" ? undefined : stateText,
      select: event => { if (canSelect && !current) onSelect(option.backend); else event.preventDefault(); } };
  });
  return <div className="chat-remote-selector" data-remote-agent-selector><AgentPicker value={(value || "codex") as RemoteTarget["agents"][number]["backend"]}
    open={open} onOpenChange={setOpen} label={`${copy.agent}: ${label}`} disabled={disabled || !options.length} tone={selectedState && selectedState !== "ready" ? "attention" : "quiet"}
    rows={rows} descriptionId={descriptionId} announcement={options.length ? label : undefined} /></div>;
}
